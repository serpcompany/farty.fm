import { describe, expect, it } from 'vitest'

import type { Kind } from '@/db/library'
import { shares } from '@/db/schema'
import { findSharedRecording, findSharedToot } from '@/server/sharing'
import { api, media, ORIGIN, R1, signUp, T1, testDb, wav } from '@/test-support/library-api'
import {
  linkParts,
  saveToot,
  share,
  sharer,
  shareUrl,
  tootSharer,
  tootWav,
  uploadRecording,
  withHandle
} from '@/test-support/sharing-api'

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

type Signed = Awaited<ReturnType<typeof withHandle>>

const KINDS: {
  name: string
  kind: Kind
  segment: 'r' | 't'
  id: string
  audio: () => Uint8Array
  sharer: (name: string) => Promise<Signed & { url: string }>
  keep: (user: Signed) => Promise<void>
  find: (handle: string, shareId: string) => Promise<object | null>
}[] = [
  {
    name: 'Recording',
    kind: 'recordings',
    segment: 'r',
    id: R1,
    audio: () => wav(),
    sharer,
    keep: user => uploadRecording(R1, user),
    find: (handle, shareId) => findSharedRecording(testDb(), handle, shareId)
  },
  {
    name: 'saved Toot',
    kind: 'toots',
    segment: 't',
    id: T1,
    audio: tootWav,
    sharer: tootSharer,
    keep: user => saveToot(T1, user),
    find: (handle, shareId) => findSharedToot(testDb(), handle, shareId)
  }
]

describe.each(KINDS)('Sharing a $name', ({
  kind,
  segment,
  id,
  audio,
  sharer: shareOne,
  keep,
  find
}) => {
  it('makes a link anyone can play, whole and as stored, and the same link again', async () => {
    const alice = await shareOne('alice')
    expect(alice.url).toMatch(new RegExp(`^${ORIGIN}/u/alice/${segment}/[0-9a-hjkmnp-tv-z]{12}/$`))
    expect(alice.url).not.toContain(id)

    const again = await share.put(id, alice, kind)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ url: alice.url })

    const played = await share.audio(alice.url)
    expect(played.status).toBe(200)
    expect(played.headers.get('content-type')).toBe('audio/wav')
    expect(played.headers.get('cache-control')).toBe('private, no-cache')
    expect(played.headers.get('content-length')).toBe(String(audio().byteLength))
    expect(new Uint8Array(await played.arrayBuffer())).toEqual(audio())

    expect(await (await share.list(alice)).json()).toEqual({
      handle: 'alice',
      shares: [{ kind, itemId: id, url: alice.url }]
    })
  })

  it('serves the audio from the cache, and answers 304 to a browser that has it', async () => {
    const alice = await shareOne('alice')
    const first = await share.audio(alice.url)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    await first.arrayBuffer()

    const unchanged = await share.audio(alice.url, { headers: { 'if-none-match': etag ?? '' } })
    expect(unchanged.status).toBe(304)
    expect(unchanged.headers.get('cache-control')).toBe('private, no-cache')

    await media().delete(`users/${alice.id}/${kind}/${id}.wav`)
    const cached = await share.audio(alice.url)
    expect(cached.status).toBe(200)
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(audio())
  })

  it("can't be shared or stopped by anyone but its owner", async () => {
    const alice = await shareOne('alice')
    const bob = await withHandle('bob')

    expect((await share.put(id, bob, kind)).status).toBe(404)
    expect((await share.stop(id, bob, kind)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(200)
    expect(await (await share.list(bob)).json()).toEqual({ handle: 'bob', shares: [] })
    expect(await testDb().select().from(shares)).toHaveLength(1)
  })

  it('stops working when its owner stops sharing it, and a new share is a new link', async () => {
    const alice = await shareOne('alice')
    const elsewhere = { ...alice, origin: 'https://evil.example' }
    expect((await share.stop(id, elsewhere, kind)).status).toBe(403)
    expect((await share.audio(alice.url)).status).toBe(200)

    expect((await share.stop(id, alice, kind)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    const { handle, id: shareId } = linkParts(alice.url)
    expect(await find(handle, shareId)).toBeNull()
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })

    const url = await shareUrl(id, alice, kind)
    expect(url).not.toBe(alice.url)
    expect((await share.audio(url)).status).toBe(200)
    expect((await share.audio(alice.url)).status).toBe(404)
  })

  it('stops working when it is deleted', async () => {
    const alice = await shareOne('alice')
    expect((await api.delete(kind, id, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
    expect((await share.put(id, alice, kind)).status).toBe(410)
  })

  it('stops working when the account is deleted', async () => {
    const alice = await shareOne('alice')
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('stays down once Farty takes it down, even if its owner shares it again', async () => {
    const alice = await shareOne('alice')
    await testDb().update(shares).set({ takenDownAt: new Date() })
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)

    const again = await share.put(id, alice, kind)
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'taken_down' })
    expect((await share.stop(id, alice, kind)).status).toBe(204)
    expect((await share.put(id, alice, kind)).status).toBe(403)
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })
  })

  it('never opens a link nobody shared', async () => {
    const alice = await withHandle('alice')
    await keep(alice)
    for (const link of ['000000000000', 'abc', id]) {
      expect((await share.audio(`${ORIGIN}/u/alice/${segment}/${link}/`)).status).toBe(404)
    }
  })
})
