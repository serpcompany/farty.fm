import type { Kind } from '@/lib/outbox'

type Stored = { item: Record<string, unknown>; wav: ArrayBuffer | null; deletedAt: number | null }

type Sent = { method: string; path: string; library: string | null }

const DAY = 24 * 60 * 60 * 1000

export function fakeAccount(userId = 'user-a') {
  const items: Record<Kind, Map<string, Stored & { updatedAt: number }>> = {
    recordings: new Map(),
    toots: new Map()
  }
  let now = 40 * DAY
  const tick = () => {
    now += 1
    return now
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
      const stored = items.toots.get(id)
      if (stored) {
        items.toots.set(id, { ...stored, item: { ...stored.item, title }, updatedAt: tick() })
      }
    },
    get(kind: Kind, id: string) {
      const stored = items[kind].get(id)
      return stored && !stored.deletedAt ? stored : undefined
    },
    isDeleted: (kind: Kind, id: string) => Boolean(items[kind].get(id)?.deletedAt),
    advance(ms: number) {
      now += ms
    },
    expireTombstones() {
      for (const kind of ['recordings', 'toots'] as const) {
        for (const [id, stored] of items[kind]) if (stored.deletedAt) items[kind].delete(id)
      }
    },
    fetch: async (input: string, init: RequestInit = {}): Promise<Response> => {
      const url = new URL(input, 'https://farty.test')
      const method = init.method ?? 'GET'
      const library = new Headers(init.headers).get('x-pedos-library')
      const request: Sent = { method, path: url.pathname + url.search, library }
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
      const { title } = JSON.parse(String(init.body))
      items[kind].set(id, { ...stored, item: { ...stored.item, title }, updatedAt: tick() })
      return Response.json({ id, title })
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
