// An account's library for the unit tests, which run in Node: a fake `fetch` answering the routes
// `library-api.ts` calls as `src/server/library.ts` does, for one signed-in user. The real routes
// are tested in workerd (`library.workers.test.ts`).

import type { Kind } from './outbox'
import type { Trim } from './recordings'

type Stored = { item: Record<string, unknown>; wav: ArrayBuffer | null; deletedAt: number | null }

/** A request this account got, with its JSON body (a PATCH's), if it had one. */
export type Sent = { method: string; path: string; library: string | null; json?: unknown }

const DAY = 24 * 60 * 60 * 1000

export function fakeAccount(userId = 'user-a') {
  const items: Record<Kind, Map<string, Stored & { updatedAt: number }>> = {
    recordings: new Map(),
    toots: new Map()
  }
  // As D1's clock: past the 30 days tombstones are kept, so a read since 0 is `full`.
  let now = 40 * DAY
  const tick = () => {
    now += 1
    return now
  }
  const sent: Sent[] = []
  const state = {
    sent,
    /** Every request fails as if offline. */
    offline: false,
    /** Answers a request before the account does, if it returns a response. */
    intercept: null as
      | null
      | ((sent: Sent) => Response | undefined | Promise<Response | undefined>),
    /** What another browser did: adds a Recording or Toot to the account. */
    add(kind: Kind, item: { id: string } & Record<string, unknown>, wav: ArrayBuffer | null) {
      items[kind].set(item.id, { item, wav, deletedAt: null, updatedAt: tick() })
    },
    /** What another browser did: deletes one, leaving a tombstone. */
    remove(kind: Kind, id: string) {
      const stored = items[kind].get(id)
      if (stored) items[kind].set(id, { ...stored, wav: null, deletedAt: tick(), updatedAt: now })
    },
    /** What another browser did: renames a Toot. */
    rename(id: string, title: string) {
      const stored = items.toots.get(id)
      if (stored) {
        items.toots.set(id, { ...stored, item: { ...stored.item, title }, updatedAt: tick() })
      }
    },
    /** What another browser did: places a Recording on a note, or takes it off. */
    place(id: string, placedPitch: number | null) {
      state.placeAndTrim(id, { placedPitch })
    },
    /** What another browser did: places or trims a Recording, or takes either off (ADR 0019). */
    placeAndTrim(id: string, change: { placedPitch?: number | null; trim?: Trim | null }) {
      const stored = items.recordings.get(id)
      if (stored) {
        items.recordings.set(id, {
          ...stored,
          item: { ...stored.item, ...change },
          updatedAt: tick()
        })
      }
    },
    /** Its live item, or undefined. */
    get(kind: Kind, id: string) {
      const stored = items[kind].get(id)
      return stored && !stored.deletedAt ? stored : undefined
    },
    isDeleted: (kind: Kind, id: string) => Boolean(items[kind].get(id)?.deletedAt),
    /** Moves the account's clock on. */
    advance(ms: number) {
      now += ms
    },
    /** Forgets every tombstone, as a purge does once they're old. */
    expireTombstones() {
      for (const kind of ['recordings', 'toots'] as const) {
        for (const [id, stored] of items[kind]) if (stored.deletedAt) items[kind].delete(id)
      }
    },
    fetch: async (input: string, init: RequestInit = {}): Promise<Response> => {
      const url = new URL(input, 'https://pedos.test')
      const method = init.method ?? 'GET'
      const library = new Headers(init.headers).get('x-pedos-library')
      const request: Sent = { method, path: url.pathname + url.search, library }
      if (typeof init.body === 'string') request.json = JSON.parse(init.body)
      sent.push(request)
      if (state.offline) throw new TypeError('Failed to fetch')
      const intercepted = await state.intercept?.(request)
      if (intercepted) return intercepted
      return answer(method, url, init, library)
    }
  }

  async function answer(method: string, url: URL, init: RequestInit, library: string | null) {
    const error = (status: number, code: string) => Response.json({ error: code }, { status })
    if (library !== null && library !== userId) return error(409, 'wrong_account')
    if (url.pathname === '/api/library/') {
      const since = Number(url.searchParams.get('since') ?? '0')
      const changed = (kind: Kind) => [...items[kind].values()].filter(s => s.updatedAt >= since)
      const live = (kind: Kind) =>
        changed(kind)
          .filter(s => !s.deletedAt)
          .map(s => ({ ...s.item, audioBytes: s.wav?.byteLength ?? 0 }))
      const deleted = (kind: Kind) =>
        changed(kind)
          .filter(s => s.deletedAt)
          .map(s => s.item.id)
      return Response.json({
        cursor: now,
        full: since < now - 30 * DAY,
        recordings: live('recordings'),
        toots: live('toots'),
        deleted: { recordings: deleted('recordings'), toots: deleted('toots') }
      })
    }
    const match = url.pathname.match(/^\/api\/(recordings|toots)\/([^/]+)\/(audio\/)?$/)
    if (!match) return error(404, 'not_found')
    const kind = match[1] as Kind
    const id = match[2]
    const stored = items[kind].get(id)
    if (match[3]) {
      return stored?.wav && !stored.deletedAt
        ? new Response(stored.wav.slice(0), { headers: { 'content-type': 'audio/wav' } })
        : error(404, 'not_found')
    }
    if (method === 'PUT') {
      if (stored?.deletedAt) return error(410, 'deleted')
      if (stored) return Response.json({ id }, { status: 200 })
      const form = init.body as FormData
      const item = JSON.parse(String(form.get('metadata')))
      const wav = await (form.get('audio') as Blob).arrayBuffer()
      items[kind].set(id, { item, wav, deletedAt: null, updatedAt: tick() })
      return Response.json({ id }, { status: 201 })
    }
    if (method === 'PATCH') {
      if (!stored) return error(404, 'not_found')
      if (stored.deletedAt) return error(410, 'deleted')
      // A Toot's `{ title }` or a Recording's `{ placedPitch, trim }`, either left out.
      const body = JSON.parse(String(init.body))
      const changed =
        kind === 'toots'
          ? { title: body.title }
          : Object.fromEntries(
              ['placedPitch', 'trim'].filter(key => key in body).map(key => [key, body[key]])
            )
      items[kind].set(id, { ...stored, item: { ...stored.item, ...changed }, updatedAt: tick() })
      return Response.json({ id, ...changed })
    }
    if (method === 'DELETE') {
      if (!stored) return error(404, 'not_found')
      items[kind].set(id, { ...stored, wav: null, deletedAt: tick(), updatedAt: now })
      return new Response(null, { status: 204 })
    }
    return error(405, 'method_not_allowed')
  }

  return state
}

export type FakeAccount = ReturnType<typeof fakeAccount>
