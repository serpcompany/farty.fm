import { describe, expect, it, vi } from 'vitest'

import {
  api,
  audioOf,
  bucketKeys,
  library,
  R1,
  R2,
  recordingMetadata,
  signUp,
  T1,
  tootMetadata,
  upload,
  uploadBody,
  wav
} from '@/test-support/library-api'

vi.mock('@/server/toot-payments', async original =>
  (await import('@/test-support/free-payments')).freeTootPayments(original)
)

describe('one user never reaches another’s Recordings or Toots', () => {
  it('answers 404 to user B for user A’s rows and audio, and B’s uploads stay B’s', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const aRecording = wav(0.1)
    const aToot = wav(0.2)
    await upload('recordings', R1, a.cookie, aRecording)
    await upload('toots', T1, a.cookie, aToot)

    const reads = [await api.audio('recordings', R1, b), await api.audio('toots', T1, b)]
    const writes = [
      await api.delete('recordings', R1, b),
      await api.delete('toots', T1, b),
      await api.rename(T1, 'Mine now', b)
    ]
    const overwrite = await upload('recordings', R1, b.cookie, wav(0.3))

    expect(reads.map(response => response.status)).toEqual([404, 404])
    expect(writes.map(response => response.status)).toEqual([404, 404, 404])
    expect(overwrite.status).toBe(201)
    expect(await bucketKeys(`users/${a.id}/`)).toEqual([
      `users/${a.id}/recordings/${R1}.wav`,
      `users/${a.id}/toots/${T1}.wav`
    ])
    expect(await audioOf(await api.audio('recordings', R1, a))).toEqual(aRecording)
    expect(await audioOf(await api.audio('toots', T1, a))).toEqual(aToot)
    const aLibrary = await library(a.cookie)
    expect(aLibrary.recordings).toMatchObject([{ id: R1, seconds: 0.1 }])
    expect(aLibrary.toots).toMatchObject([{ id: T1, title: 'Twinkle Twinkle Little Star' }])
    const bLibrary = await library(b.cookie)
    expect(bLibrary.recordings).toMatchObject([{ id: R1, audioBytes: wav(0.3).byteLength }])
    expect(bLibrary.toots).toEqual([])
  })

  it('leaves user A’s Recording when user B deletes the same id of their own', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await upload('recordings', R1, a.cookie)
    await upload('recordings', R1, b.cookie)

    expect((await api.delete('recordings', R1, b)).status).toBe(204)

    expect((await api.audio('recordings', R1, a)).status).toBe(200)
    expect((await library(a.cookie)).deleted.recordings).toEqual([])
    expect((await api.audio('recordings', R1, b)).status).toBe(404)
  })
})

describe('every library request names its library’s account', () => {
  const uploadNaming = (cookie: string, libraryId: string) =>
    api.put('recordings', R1, uploadBody(recordingMetadata(R1), wav()), {
      cookie,
      library: libraryId
    })

  it('refuses an upload that names another account (409), and keeps nothing', async () => {
    const a = await signUp('A')
    const b = await signUp('B')

    const refused = await uploadNaming(a.cookie, b.id)

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'wrong_account' })
    expect(await bucketKeys()).toEqual([])
    expect((await library(a.cookie)).recordings).toEqual([])
    expect((await library(b.cookie)).recordings).toEqual([])
    expect((await uploadNaming(a.cookie, a.id)).status).toBe(201)
  })

  it('refuses a read, delete, rename or download that names another account, and changes nothing', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await uploadNaming(b.cookie, b.id)
    await api.put('toots', T1, uploadBody(tootMetadata(T1), wav()), { cookie: b.cookie })
    const asA = { cookie: b.cookie, library: a.id }

    for (const refused of [
      await api.library(asA),
      await api.delete('recordings', R1, asA),
      await api.delete('toots', T1, asA),
      await api.rename(T1, 'Not B’s', asA),
      await api.audio('recordings', R1, asA)
    ]) {
      expect(refused.status).toBe(409)
      expect(await refused.json()).toEqual({ error: 'wrong_account' })
    }
    const kept = await library(b.cookie)
    expect(kept.recordings).toMatchObject([{ id: R1 }])
    expect(kept.toots).toMatchObject([{ id: T1, title: 'Twinkle Twinkle Little Star' }])
    expect(kept.deleted).toEqual({ recordings: [], toots: [] })

    const asB = { cookie: b.cookie, library: b.id }
    expect((await api.library(asB)).status).toBe(200)
    expect((await api.audio('recordings', R1, asB)).status).toBe(200)
    expect((await api.rename(T1, 'B’s', asB)).status).toBe(200)
    expect((await api.delete('recordings', R1, asB)).status).toBe(204)
  })
})

describe('writes from another site', () => {
  it('are refused (403) and change nothing, even with the session cookie', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await upload('toots', T1, a.cookie)
    const elsewhere = { cookie: a.cookie, origin: 'https://evil.example' }
    const noOrigin = { cookie: a.cookie, origin: null }

    const responses = [
      await api.put('recordings', R2, uploadBody(recordingMetadata(R2), wav()), elsewhere),
      await api.put('recordings', R2, uploadBody(recordingMetadata(R2), wav()), noOrigin),
      await api.delete('recordings', R1, elsewhere),
      await api.delete('toots', T1, noOrigin),
      await api.rename(T1, 'Hijacked', elsewhere),
      await api.patchAccount({ marketingEmail: false }, elsewhere),
      await api.deleteAccount(elsewhere),
      await api.deleteAccount(noOrigin)
    ]

    expect(responses.map(response => response.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403, 403
    ])
    expect(await responses[0].json()).toEqual({ error: 'cross_origin' })
    const after = await library(a.cookie)
    expect(after.recordings.map(r => r.id)).toEqual([R1])
    expect(after.toots).toMatchObject([{ id: T1, title: 'Twinkle Twinkle Little Star' }])
    expect(after.deleted).toEqual({ recordings: [], toots: [] })
    expect(await bucketKeys()).toEqual([
      `users/${a.id}/recordings/${R1}.wav`,
      `users/${a.id}/toots/${T1}.wav`
    ])
  })

  it('does not stop a read without an Origin', async () => {
    const a = await signUp('A')

    expect((await api.library({ cookie: a.cookie, origin: null })).status).toBe(200)
  })
})

describe('caching', () => {
  it('marks every answer private and no-store', async () => {
    const a = await signUp('A')
    const responses = [
      await upload('recordings', R1, a.cookie),
      await upload('recordings', R1, a.cookie),
      await upload('recordings', R2, a.cookie, new Uint8Array(100)),
      await api.library(a),
      await api.audio('recordings', R1, a),
      await api.audio('recordings', R2, a),
      await api.delete('recordings', R1, a),
      await api.patchAccount({ marketingEmail: false }, a),
      await api.deleteAccount({ cookie: a.cookie, origin: 'https://evil.example' })
    ]

    expect(responses.map(response => response.status)).toEqual([
      201, 200, 400, 200, 200, 404, 204, 200, 403
    ])
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
  })
})
