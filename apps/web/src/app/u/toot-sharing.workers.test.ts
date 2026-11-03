import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { shares } from '@/db/schema'
import { encodeWav } from '@/lib/wav'
import { SHARED_TOOT_BARS, sharedTootLevels } from '@/server/shared-audio'
import { findSharedRecording, findSharedToot, sharedTootKey } from '@/server/sharing'
import {
  api,
  media,
  ORIGIN,
  padTootMetadata,
  R1,
  R2,
  signUp,
  T1,
  testDb,
  tootMetadata
} from '@/test-support/library-api'
import {
  linkParts,
  payFor,
  playing,
  saveToot,
  share,
  shareUrl,
  TOOT_RECORDING,
  tootSharer,
  tootWav,
  uploadRecording,
  withHandle
} from '@/test-support/sharing-api'

const T2 = '44444444-4444-4444-8444-444444444444'

describe('Sharing a saved Toot', () => {
  it('needs a Handle and a saved Toot of your own', async () => {
    const alice = await signUp('alice')
    await saveToot(T1, alice)
    expect(await (await share.put(T1, alice, 'toots')).json()).toEqual({ error: 'no_handle' })

    await share.pick('alice', alice)
    expect((await share.put(T2, alice, 'toots')).status).toBe(404)
    await payFor(alice, T2)
    expect((await share.put(T2, alice, 'toots')).status).toBe(404)
    await uploadRecording(R1, alice)
    expect((await share.put(R1, alice, 'toots')).status).toBe(404)
    expect((await share.put('not-an-id', alice, 'toots')).status).toBe(404)
    expect((await share.put(T1, { ...alice, library: 'someone-else' }, 'toots')).status).toBe(409)
    const elsewhere = { ...alice, origin: 'https://evil.example' }
    expect((await share.put(T1, elsewhere, 'toots')).status).toBe(403)
    expect((await share.put(T1, {}, 'toots')).status).toBe(401)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('lists Recordings and Toots, each opening only under its own kind of link', async () => {
    const alice = await tootSharer('alice')
    await uploadRecording(R1, alice)
    const recordingUrl = await shareUrl(R1, alice)
    expect(recordingUrl).toMatch(new RegExp(`^${ORIGIN}/u/alice/r/`))

    const { shares: listed } = (await (await share.list(alice)).json()) as { shares: unknown[] }
    expect(listed).toHaveLength(2)
    expect(listed).toEqual(
      expect.arrayContaining([
        { kind: 'toots', itemId: T1, url: alice.url },
        { kind: 'recordings', itemId: R1, url: recordingUrl }
      ])
    )

    const asRecording = alice.url.replace('/t/', '/r/')
    const asToot = recordingUrl.replace('/r/', '/t/')
    expect((await share.audio(asRecording)).status).toBe(404)
    expect((await share.audio(asToot)).status).toBe(404)
    expect((await share.report(asRecording)).status).toBe(404)
    expect((await share.report(asToot)).status).toBe(404)
    expect(await findSharedRecording(testDb(), 'alice', linkParts(alice.url).id)).toBeNull()
    expect(await findSharedToot(testDb(), 'alice', linkParts(recordingUrl).id)).toBeNull()
  })

  it("shows the page only the Toot's title, Song and length, under its owner's Handle", async () => {
    const alice = await tootSharer('alice')
    const { handle, id } = linkParts(alice.url)
    const shared = await findSharedToot(testDb(), handle, id)
    if (!shared) throw new Error('Not shared')
    const { row: _, ...shown } = shared
    expect(shown).toEqual({
      handle: 'alice',
      shareId: id,
      title: 'Twinkle Twinkle Little Star',
      songId: 'twinkle',
      seconds: 0.1
    })
    const page = JSON.stringify(shown)
    for (const secret of [T1, alice.id, 'alice@example.test', TOOT_RECORDING]) {
      expect(page).not.toContain(secret)
    }
    expect(await findSharedToot(testDb(), 'ALICE', id)).not.toBeNull()
    await tootSharer('bob')
    expect(await findSharedToot(testDb(), 'bob', id)).toBeNull()
    expect((await share.audio(alice.url.replace('/u/alice/', '/u/bob/'))).status).toBe(404)
  })

  it('shares a Sound Pad Toot too', async () => {
    const alice = await withHandle('alice')
    await saveToot(T2, alice, tootWav(), padTootMetadata(T2))
    const url = await shareUrl(T2, alice, 'toots')
    const { handle, id } = linkParts(url)
    expect(await findSharedToot(testDb(), handle, id)).toMatchObject({
      title: 'Sound Pad',
      songId: null
    })
    expect((await share.audio(url)).status).toBe(200)
  })

  it('stays down while a Recording it plays is taken down, and never shares again', async () => {
    const alice = await withHandle('alice')
    await uploadRecording(R1, alice)
    await shareUrl(R1, alice)
    const arrangement = { transposition: 0, recordingForPitch: { 60: R2, 64: R1 } }
    await saveToot(T1, alice, tootWav(), tootMetadata(T1, { arrangement }))
    await saveToot(T2, alice, tootWav(), padTootMetadata(T2, { performance: playing(R1) }))
    const url = await shareUrl(T1, alice, 'toots')
    expect((await share.audio(url)).status).toBe(200)

    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))

    expect((await share.audio(url)).status).toBe(404)
    expect((await share.report(url)).status).toBe(404)
    const { handle, id } = linkParts(url)
    expect(await findSharedToot(testDb(), handle, id)).toBeNull()
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })
    for (const toot of [T1, T2]) {
      const again = await share.put(toot, alice, 'toots')
      expect(again.status).toBe(403)
      expect(await again.json()).toEqual({ error: 'taken_down' })
    }
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect((await share.audio(url)).status).toBe(404)
    expect((await share.put(T2, alice, 'toots')).status).toBe(403)
  })

  it('shares a Toot whose Recordings are up, though another Recording is down', async () => {
    const alice = await withHandle('alice')
    await uploadRecording(R1, alice)
    await shareUrl(R1, alice)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))
    await saveToot(T2, alice, tootWav(), padTootMetadata(T2, { performance: playing(R2) }))
    const url = await shareUrl(T2, alice, 'toots')
    expect((await share.audio(url)).status).toBe(200)
    expect(await (await share.list(alice)).json()).toEqual({
      handle: 'alice',
      shares: [{ kind: 'toots', itemId: T2, url }]
    })
  })

  it('draws its bars from the saved WAV, kept in the cache by its R2 key', async () => {
    const dora = await withHandle('dora')
    const loudThenSilent = Float32Array.from({ length: 6000 }, (_, i) => (i < 3000 ? 0.5 : 0))
    await saveToot(
      T2,
      dora,
      new Uint8Array(encodeWav({ samples: loudThenSilent, sampleRate: 8000 }))
    )
    const { handle, id } = linkParts(await shareUrl(T2, dora, 'toots'))
    const shared = await findSharedToot(testDb(), handle, id)
    if (!shared) throw new Error('Not shared')

    const key = sharedTootKey(shared)
    expect(key).toBe(`users/${dora.id}/toots/${T2}.wav`)
    const levels = await sharedTootLevels(media(), key, ORIGIN)
    expect(levels).toHaveLength(SHARED_TOOT_BARS)
    expect(levels).toEqual([...Array(30).fill(1), ...Array(30).fill(0.05)])

    await media().delete(key)
    expect(await sharedTootLevels(media(), key, ORIGIN)).toEqual(levels)
    const neverDrawn = await sharedTootLevels(media(), `users/${dora.id}/toots/${T1}.wav`, ORIGIN)
    expect(neverDrawn).toEqual(Array(SHARED_TOOT_BARS).fill(0.05))
  })
})
