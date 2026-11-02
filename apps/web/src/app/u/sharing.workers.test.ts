import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import * as shareRecordingRoute from '@/app/api/share/recordings/[id]/route'
import * as sharesRoute from '@/app/api/share/route'
import { rateLimit, shareReports, shares } from '@/db/schema'
import { findSharedRecording } from '@/server/sharing'
import {
  type As,
  api,
  media,
  ORIGIN,
  recordingMetadata,
  signUp,
  testDb,
  uploadBody,
  wav
} from '@/test-support/library-api'

import * as audioRoute from './[handle]/r/[id]/audio/route'
import * as reportRoute from './[handle]/r/[id]/report/route'

// Sharing (ADR 0020) in workerd, with a real D1 and R2: Handles, sharing and stopping sharing a
// Recording, its public audio and Report, and that a link works only while its Recording is
// shared, by its owner, under their Handle.

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'

const params = <P>(value: P) => ({ params: Promise.resolve(value) })

function request(path: string, method: string, as: As, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (as.cookie) headers.set('cookie', as.cookie)
  if (as.library) headers.set('x-pedos-library', as.library)
  const origin = as.origin === undefined ? (method === 'GET' ? null : ORIGIN) : as.origin
  if (origin !== null) headers.set('origin', origin)
  return new Request(`${ORIGIN}${path}`, { ...init, method, headers })
}

const json = (body: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const share = {
  handle: (as: As) => handleRoute.GET(request('/api/handle/', 'GET', as), params({})),
  check: (handle: string, as: As) =>
    handleRoute.GET(
      request(`/api/handle/?check=${encodeURIComponent(handle)}`, 'GET', as),
      params({})
    ),
  pick: (handle: unknown, as: As) =>
    handleRoute.PUT(request('/api/handle/', 'PUT', as, json({ handle })), params({})),
  list: (as: As) => sharesRoute.GET(request('/api/share/', 'GET', as), params({})),
  put: (id: string, as: As) =>
    shareRecordingRoute.PUT(request(`/api/share/recordings/${id}/`, 'PUT', as), params({ id })),
  stop: (id: string, as: As) =>
    shareRecordingRoute.DELETE(
      request(`/api/share/recordings/${id}/`, 'DELETE', as),
      params({ id })
    ),
  /** The shared Recording's audio, as anyone with the link fetches it: no cookie. */
  audio: (url: string, init: RequestInit = {}) => {
    const { handle, id } = linkParts(url)
    return audioRoute.GET(
      new Request(`${url}audio/`, { ...init, method: 'GET' }),
      params({ handle, id })
    )
  },
  report: (url: string, origin: string | null = ORIGIN) => {
    const { handle, id } = linkParts(url)
    const headers = origin === null ? undefined : { origin }
    return reportRoute.POST(
      new Request(`${url}report/`, { method: 'POST', headers }),
      params({ handle, id })
    )
  }
}

function linkParts(url: string): { handle: string; id: string } {
  const match = new URL(url).pathname.match(/^\/u\/([^/]+)\/r\/([^/]+)\/$/)
  if (!match) throw new Error(`Not a share link: ${url}`)
  return { handle: match[1], id: match[2] }
}

async function upload(id: string, cookie: string) {
  const response = await api.put('recordings', id, uploadBody(recordingMetadata(id), wav()), {
    cookie
  })
  expect(response.status).toBe(201)
}

/** A user with a Handle and an uploaded Recording `R1`, shared: its link. */
async function sharer(name: string) {
  const user = await signUp(name)
  expect((await share.pick(name, user)).status).toBe(201)
  await upload(R1, user.cookie)
  const response = await share.put(R1, user)
  expect(response.status).toBe(201)
  const { url } = (await response.json()) as { url: string }
  return { ...user, url }
}

describe('Handles', () => {
  it('suggests one from the email, and checks each as it is typed', async () => {
    const alice = await signUp('alice')
    expect(await (await share.handle(alice)).json()).toEqual({ handle: null, suggestion: 'alice' })

    const problem = async (handle: string) =>
      ((await (await share.check(handle, alice)).json()) as { problem: string | null }).problem
    expect(await problem('ab')).toBe('short')
    expect(await problem('a'.repeat(21))).toBe('long')
    expect(await problem('a-b')).toBe('chars')
    expect(await problem('Farty')).toBe('blocked')
    expect(await problem('@Alice_1')).toBeNull()

    const bob = await signUp('bob')
    expect((await share.pick('alice_1', bob)).status).toBe(201)
    expect(await problem('alice_1')).toBe('taken')
  })

  it('is picked once, unique, and never one on the block list', async () => {
    const alice = await signUp('alice')
    const bob = await signUp('bob')

    const blocked = await share.pick('admin', alice)
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toEqual({ error: 'handle_unusable', problem: 'blocked' })
    expect((await share.pick(42, alice)).status).toBe(400)

    const picked = await share.pick('@Alice', alice)
    expect(picked.status).toBe(201)
    expect(await picked.json()).toEqual({ handle: 'alice' })
    expect(await (await share.handle(alice)).json()).toEqual({ handle: 'alice', suggestion: null })

    const again = await share.pick('alice2', alice)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'has_handle', handle: 'alice' })

    const taken = await share.pick('alice', bob)
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: 'handle_taken' })
    // Someone else's email name isn't suggested once it's taken.
    const carol = await signUp('alice2')
    expect(((await (await share.handle(carol)).json()) as { suggestion: string }).suggestion).toBe(
      'alice2'
    )
  })

  it('is refused from another site, and to someone signed out', async () => {
    const alice = await signUp('alice')
    expect((await share.pick('alice', { ...alice, origin: 'https://evil.example' })).status).toBe(
      403
    )
    expect((await share.pick('alice', {})).status).toBe(401)
    expect(await (await share.handle(alice)).json()).toMatchObject({ handle: null })
  })
})

describe('Sharing a Recording', () => {
  it('needs a Handle and an uploaded Recording of your own', async () => {
    const alice = await signUp('alice')
    await upload(R1, alice.cookie)
    expect(await (await share.put(R1, alice)).json()).toEqual({ error: 'no_handle' })

    await share.pick('alice', alice)
    expect((await share.put(R2, alice)).status).toBe(404)
    expect((await share.put('not-an-id', alice)).status).toBe(404)
    expect((await share.put(R1, { ...alice, library: 'someone-else' })).status).toBe(409)
    expect((await share.put(R1, {})).status).toBe(401)
  })

  it('makes a link anyone can play, and the same link again', async () => {
    const alice = await sharer('alice')
    expect(alice.url).toMatch(new RegExp(`^${ORIGIN}/u/alice/r/[0-9a-hjkmnp-tv-z]{12}/$`))
    // The link names a share of its own, never the Recording's id.
    expect(alice.url).not.toContain(R1)

    const again = await share.put(R1, alice)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ url: alice.url })

    const audio = await share.audio(alice.url)
    expect(audio.status).toBe(200)
    expect(audio.headers.get('content-type')).toBe('audio/wav')
    expect(audio.headers.get('cache-control')).toBe('private, no-cache')
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(wav())

    const listed = await (await share.list(alice)).json()
    expect(listed).toEqual({
      handle: 'alice',
      shares: [{ kind: 'recordings', itemId: R1, url: alice.url }]
    })
  })

  it('serves the audio from the cache, and answers 304 to a browser that has it', async () => {
    const alice = await sharer('alice')
    const first = await share.audio(alice.url)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    await first.arrayBuffer()

    const unchanged = await share.audio(alice.url, { headers: { 'if-none-match': etag ?? '' } })
    expect(unchanged.status).toBe(304)

    // The copy in the cache plays even once R2's is gone, while the share works.
    await media().delete(`users/${alice.id}/recordings/${R1}.wav`)
    const cached = await share.audio(alice.url)
    expect(cached.status).toBe(200)
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(wav())
  })

  it('shows the page only the Recording, with the link as its id', async () => {
    const alice = await sharer('alice')
    const { handle, id } = linkParts(alice.url)
    const shared = await findSharedRecording(testDb(), handle, id)
    expect(shared).toMatchObject({ handle: 'alice', shareId: id, recording: { id, number: 1 } })
    expect(shared?.recording).not.toHaveProperty('audioBytes')
    // The Handle in the link is matched as lowercase, and must be the owner's.
    expect(await findSharedRecording(testDb(), 'ALICE', id)).not.toBeNull()
    await sharer('bob')
    expect(await findSharedRecording(testDb(), 'bob', id)).toBeNull()
    expect((await share.audio(alice.url.replace('/u/alice/', '/u/bob/'))).status).toBe(404)
  })

  it("can't be shared or stopped by anyone but its owner", async () => {
    const alice = await sharer('alice')
    const bob = await signUp('bob')
    await share.pick('bob', bob)

    expect((await share.put(R1, bob)).status).toBe(404)
    expect((await share.stop(R1, bob)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(200)
    expect(await (await share.list(bob)).json()).toEqual({ handle: 'bob', shares: [] })
  })

  it('stops working when its owner stops sharing it, and a new share is a new link', async () => {
    const alice = await sharer('alice')
    expect((await share.stop(R1, { ...alice, origin: 'https://evil.example' })).status).toBe(403)
    expect((await share.audio(alice.url)).status).toBe(200)

    expect((await share.stop(R1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    const { handle, id } = linkParts(alice.url)
    expect(await findSharedRecording(testDb(), handle, id)).toBeNull()
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })

    const again = await share.put(R1, alice)
    expect(again.status).toBe(201)
    const { url } = (await again.json()) as { url: string }
    expect(url).not.toBe(alice.url)
    expect((await share.audio(url)).status).toBe(200)
    expect((await share.audio(alice.url)).status).toBe(404)
  })

  it('stops working when the Recording is deleted', async () => {
    const alice = await sharer('alice')
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
    expect((await share.put(R1, alice)).status).toBe(410)
  })

  it('stops working when the account is deleted', async () => {
    const alice = await sharer('alice')
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('stays down once Farty takes it down, even if its owner shares it again', async () => {
    const alice = await sharer('alice')
    await testDb().update(shares).set({ takenDownAt: new Date() })
    expect((await share.audio(alice.url)).status).toBe(404)

    const again = await share.put(R1, alice)
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'taken_down' })
    expect((await share.stop(R1, alice)).status).toBe(204)
    expect((await share.put(R1, alice)).status).toBe(403)
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })
  })

  it('never opens a link nobody shared', async () => {
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await upload(R1, alice.cookie)
    for (const id of ['000000000000', 'abc', R1]) {
      expect((await share.audio(`${ORIGIN}/u/alice/r/${id}/`)).status).toBe(404)
    }
  })
})

describe('Reporting a shared Recording', () => {
  it('keeps a row naming the share and the Recording, not the reporter', async () => {
    const alice = await sharer('alice')
    const response = await share.report(alice.url)
    expect(response.status).toBe(204)
    const rows = await testDb().select().from(shareReports)
    expect(rows).toEqual([
      expect.objectContaining({
        shareId: linkParts(alice.url).id,
        userId: alice.id,
        kind: 'recordings',
        itemId: R1
      })
    ])
  })

  it('is refused from another site, or with no origin', async () => {
    const alice = await sharer('alice')
    expect((await share.report(alice.url, 'https://evil.example')).status).toBe(403)
    expect((await share.report(alice.url, null)).status).toBe(403)
    expect(await testDb().select().from(shareReports)).toEqual([])
  })

  it('keeps a few reports a day per link', async () => {
    const alice = await sharer('alice')
    for (let i = 0; i < 7; i++) expect((await share.report(alice.url)).status).toBe(204)
    const { id } = linkParts(alice.url)
    const rows = await testDb().select().from(shareReports).where(eq(shareReports.shareId, id))
    expect(rows).toHaveLength(5)
    // Reports past the link's few don't spend the site's, so one link can't block the rest.
    const [site] = await testDb()
      .select({ count: rateLimit.count })
      .from(rateLimit)
      .where(eq(rateLimit.key, 'share_report'))
    expect(site?.count).toBe(5)
  })

  it('goes with the account', async () => {
    const alice = await sharer('alice')
    await share.report(alice.url)
    await api.deleteAccount(alice)
    expect(await testDb().select().from(shareReports)).toEqual([])
  })
})
