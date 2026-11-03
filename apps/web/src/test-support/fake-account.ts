import type { Kind } from '@/lib/outbox'
import type { RecordingTrim } from '@/lib/recordings'

type Stored = { item: Record<string, unknown>; wav: ArrayBuffer | null; deletedAt: number | null }

type Sent = { method: string; path: string; library: string | null; json?: unknown }

const DAY = 24 * 60 * 60 * 1000

export function fakeAccount(userId = 'user-a') {
  const items: Record<Kind, Map<string, Stored & { updatedAt: number }>> = {
    recordings: new Map(),
    toots: new Map()
  }
  const favorites = new Map<string, { deletedAt: number | null; updatedAt: number }>()
  let now = 40 * DAY
  const tick = () => {
    now += 1
    return now
  }
  const change = (kind: Kind, id: string, fields: Record<string, unknown>) => {
    const stored = items[kind].get(id)
    if (stored) {
      items[kind].set(id, { ...stored, item: { ...stored.item, ...fields }, updatedAt: tick() })
    }
  }
  const sent: Sent[] = []
  const state = {
    sent,
    offline: false,
    intercept: null as
      | null
      | ((sent: Sent) => Response | undefined | Promise<Response | undefined>),
    add(kind: Kind, item: { id: string } & Record<string, unknown>, wav: ArrayBuffer | null) {
      items[kind].set(item.id, { item, wav, deletedAt: null, updatedAt: tick() })
    },
    remove(kind: Kind, id: string) {
      const stored = items[kind].get(id)
      if (stored) items[kind].set(id, { ...stored, wav: null, deletedAt: tick(), updatedAt: now })
    },
    rename(id: string, title: string) {
      change('toots', id, { title })
    },
    place(id: string, placedPitch: number | null) {
      change('recordings', id, { placedPitch })
    },
    placeAndTrim(
      id: string,
      fields: { placedPitch?: number | null; trim?: RecordingTrim | null; name?: string | null }
    ) {
      change('recordings', id, fields)
    },
    get(kind: Kind, id: string) {
      const stored = items[kind].get(id)
      return stored && !stored.deletedAt ? stored : undefined
    },
    isDeleted: (kind: Kind, id: string) => Boolean(items[kind].get(id)?.deletedAt),
    setFavorite(songId: string, on: boolean) {
      const at = tick()
      favorites.set(songId, { deletedAt: on ? null : at, updatedAt: at })
    },
    favorites: () =>
      [...favorites]
        .filter(([, f]) => !f.deletedAt)
        .map(([songId]) => songId)
        .sort(),
    advance(ms: number) {
      now += ms
    },
    expireTombstones() {
      for (const kind of ['recordings', 'toots'] as const) {
        for (const [id, stored] of items[kind]) if (stored.deletedAt) items[kind].delete(id)
      }
      for (const [songId, f] of favorites) if (f.deletedAt) favorites.delete(songId)
    },
    fetch: async (input: string, init: RequestInit = {}): Promise<Response> => {
      const url = new URL(input, 'https://farty.test')
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
      const asked = Number(url.searchParams.get('since') ?? '0')
      const full = asked < now - 30 * DAY
      const since = full ? 0 : asked
      const changed = (kind: Kind) => [...items[kind].values()].filter(s => s.updatedAt >= since)
      const live = (kind: Kind) =>
        changed(kind)
          .filter(s => !s.deletedAt)
          .map(s => ({ ...s.item, audioBytes: s.wav?.byteLength ?? 0 }))
      const deleted = (kind: Kind) =>
        changed(kind)
          .filter(s => s.deletedAt)
          .map(s => s.item.id)
      const favoritesSince = [...favorites].filter(([, f]) => f.updatedAt >= since)
      return Response.json({
        cursor: now,
        full,
        recordings: live('recordings'),
        toots: live('toots'),
        favorites: favoritesSince.filter(([, f]) => !f.deletedAt).map(([songId]) => songId),
        deleted: {
          recordings: deleted('recordings'),
          toots: deleted('toots'),
          favorites: favoritesSince.filter(([, f]) => f.deletedAt).map(([songId]) => songId)
        }
      })
    }
    const favorite = url.pathname.match(/^\/api\/favorites\/([^/]+)\/$/)
    if (favorite) {
      const songId = decodeURIComponent(favorite[1])
      const was = favorites.get(songId)
      if (method === 'PUT') {
        if (was && !was.deletedAt) return Response.json({ songId }, { status: 200 })
        favorites.set(songId, { deletedAt: null, updatedAt: tick() })
        return Response.json({ songId }, { status: 201 })
      }
      if (method === 'DELETE') {
        if (was && !was.deletedAt) favorites.set(songId, { deletedAt: tick(), updatedAt: now })
        return new Response(null, { status: 204 })
      }
      return error(405, 'method_not_allowed')
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
      const body = JSON.parse(String(init.body))
      const changed =
        kind === 'toots'
          ? { title: body.title }
          : Object.fromEntries(
              ['placedPitch', 'trim', 'name']
                .filter(key => key in body)
                .map(key => [key, body[key]])
            )
      change(kind, id, changed)
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
