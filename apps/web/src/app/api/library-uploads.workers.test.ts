import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { Kind } from '@/db/library'
import { recordings } from '@/db/schema'
import { maximumTakeSeconds } from '@/lib/recordings'
import {
  api,
  audioOf,
  bucketKeys,
  library,
  media,
  metadataFor,
  R1,
  R2,
  recordingMetadata,
  rowsOf,
  seed,
  signUp,
  T1,
  testDb,
  upload,
  uploadBody,
  wav
} from '@/test-support/library-api'

vi.mock('@/server/toot-payments', async original =>
  (await import('@/test-support/free-payments')).freeTootPayments(original)
)

const R3 = '66666666-6666-4666-8666-666666666666'
const MiB = 1024 * 1024

describe.each<Kind>(['recordings', 'toots'])('PUT /api/%s/{id}/', kind => {
  it('keeps the item, its WAV under the user’s own prefix, and lists it', async () => {
    const a = await signUp('A')
    const audio = wav(0.25)

    const put = await upload(kind, R1, a.cookie, audio)

    expect(put.status).toBe(201)
    expect(await put.json()).toEqual({ id: R1 })
    expect(await bucketKeys()).toEqual([`users/${a.id}/${kind}/${R1}.wav`])
    const listed = await library(a.cookie)
    expect(listed[kind]).toEqual([{ ...metadataFor(kind, R1), audioBytes: audio.byteLength }])
    const played = await api.audio(kind, R1, a)
    expect(played.status).toBe(200)
    expect(played.headers.get('content-type')).toBe('audio/wav')
    expect(await audioOf(played)).toEqual(audio)
  })

  it('changes nothing when an upload is retried (200)', async () => {
    const a = await signUp('A')
    const first = wav(0.1)
    await upload(kind, R1, a.cookie, first)

    const again = await api.put(
      kind,
      R1,
      uploadBody(metadataFor(kind, R1, { seconds: 0.2 }), wav(0.2)),
      a
    )

    expect(again.status).toBe(200)
    expect(await audioOf(await api.audio(kind, R1, a))).toEqual(first)
    expect((await library(a.cookie))[kind]).toMatchObject([{ id: R1, seconds: 0.1 }])
  })

  it('keeps one item when two uploads of it race (201, then 200)', async () => {
    const a = await signUp('A')

    const responses = await Promise.all([
      upload(kind, R1, a.cookie, wav(0.1)),
      upload(kind, R1, a.cookie, wav(0.1))
    ])

    expect(responses.map(response => response.status).sort()).toEqual([200, 201])
    expect(await bucketKeys()).toEqual([`users/${a.id}/${kind}/${R1}.wav`])
    expect((await library(a.cookie))[kind]).toHaveLength(1)
  })

  it('refuses an id that is not a UUID (404), so it never names a key', async () => {
    const a = await signUp('A')

    const response = await upload(kind, '..%2F..%2Fother', a.cookie)

    expect(response.status).toBe(404)
    expect(await bucketKeys()).toEqual([])
  })

  it('refuses a body that is not the upload form (415, 400)', async () => {
    const a = await signUp('A')
    const json = await api.put(kind, R1, JSON.stringify(metadataFor(kind, R1)), a, {
      headers: { 'content-type': 'application/json' }
    })
    const form = new FormData()
    form.set('metadata', JSON.stringify(metadataFor(kind, R1)))
    const noAudio = await api.put(kind, R1, form, a)
    const badJson = new FormData()
    badJson.set('metadata', '{')
    badJson.set('audio', new Blob([wav() as Uint8Array<ArrayBuffer>]), 'a.wav')
    const unparsable = await api.put(kind, R1, badJson, a)
    const wrongId = await api.put(kind, R1, uploadBody(metadataFor(kind, R2), wav()), a)

    expect(json.status).toBe(415)
    expect([noAudio.status, unparsable.status, wrongId.status]).toEqual([400, 400, 400])
    expect(await bucketKeys()).toEqual([])
    expect((await library(a.cookie))[kind]).toEqual([])
  })
})

describe('the limits', () => {
  it.each<[Kind, number]>([
    ['recordings', 6 * MiB],
    ['toots', 16 * MiB]
  ])('keeps a %s WAV of %i bytes and refuses one a sample larger (413)', async (kind, limit) => {
    const a = await signUp('A')
    const atLimit = wav((limit - 44) / 2 / 48_000)
    const overLimit = wav((limit - 44 + 2) / 2 / 48_000)
    expect([atLimit.byteLength, overLimit.byteLength]).toEqual([limit, limit + 2])

    const over = await api.put(
      kind,
      R1,
      uploadBody(metadataFor(kind, R1, { seconds: 1 }), overLimit),
      a
    )
    const at = await api.put(
      kind,
      R2,
      uploadBody(metadataFor(kind, R2, { seconds: 1 }), atLimit),
      a
    )

    expect(over.status).toBe(413)
    expect(at.status).toBe(201)
    expect(await bucketKeys()).toEqual([`users/${a.id}/${kind}/${R2}.wav`])
  })

  it('keeps a 30 s Recording at 96 kHz (201)', async () => {
    const a = await signUp('A')
    const audio = wav(maximumTakeSeconds, 96_000)
    expect(audio.byteLength).toBe(5_760_044)

    const response = await api.put(
      'recordings',
      R1,
      uploadBody(recordingMetadata(R1, { seconds: maximumTakeSeconds, sampleRate: 96_000 }), audio),
      a
    )

    expect(response.status).toBe(201)
    expect(await bucketKeys()).toEqual([`users/${a.id}/recordings/${R1}.wav`])
  })

  it('stops reading a body larger than the WAV limit and the form around it (413)', async () => {
    const a = await signUp('A')
    const response = await api.put('recordings', R1, new Uint8Array(7 * MiB), a, {
      headers: { 'content-type': 'multipart/form-data; boundary=x' }
    })

    expect(response.status).toBe(413)
  })

  it.each<Kind>([
    'recordings',
    'toots'
  ])('keeps 300 %s per account, and only 300 when uploads race (409)', async kind => {
    const a = await signUp('A')
    const b = await signUp('B')
    await seed(kind, a.id, 297)
    await seed(kind, b.id, 300)
    const ids = Array.from(
      { length: 6 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
    )

    const responses = await Promise.all(ids.map(id => upload(kind, id, a.cookie)))

    const statuses = responses.map(response => response.status).sort()
    expect(statuses).toEqual([201, 201, 201, 409, 409, 409])
    expect((await library(a.cookie))[kind]).toHaveLength(300)
    expect(await bucketKeys(`users/${a.id}/`)).toHaveLength(3)
    expect(await (await upload(kind, R1, b.cookie)).json()).toEqual({ error: 'limit_reached' })
  })

  it.each<Kind>([
    'recordings',
    'toots'
  ])('counts only live %s: a delete makes room again', async kind => {
    const a = await signUp('A')
    await seed(kind, a.id, 299)
    await upload(kind, R1, a.cookie)
    expect((await upload(kind, R2, a.cookie)).status).toBe(409)

    await api.delete(kind, R1, a)

    expect((await upload(kind, R2, a.cookie)).status).toBe(201)
    await api.delete(kind, R2, a)
    expect((await upload(kind, T1, a.cookie)).status).toBe(201)
  })
})

describe('the WAV check', () => {
  it.each([
    ['not a WAV', new TextEncoder().encode('RIFF....WAVEnot really audio at all, just text')],
    ['a header with no samples', wav(0)],
    ['a WAV cut short', wav(0.1).subarray(0, 1000)]
  ])('refuses %s (400), and keeps nothing', async (_, audio) => {
    const a = await signUp('A')

    const response = await upload('recordings', R1, a.cookie, audio)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_audio' })
    expect(await bucketKeys()).toEqual([])
    expect((await library(a.cookie)).recordings).toEqual([])
  })

  it('refuses a Recording whose sample rate is not its WAV’s (400)', async () => {
    const a = await signUp('A')

    const response = await api.put(
      'recordings',
      R1,
      uploadBody(recordingMetadata(R1, { sampleRate: 44_100 }), wav(0.1, 48_000)),
      a
    )

    expect(response.status).toBe(400)
    expect(await bucketKeys()).toEqual([])
  })
})

type Signed = Awaited<ReturnType<typeof signUp>>
type AnalysisFields = Record<string, unknown>

const analysis = (fields: AnalysisFields) => ({
  state: 'analyzed',
  analysis: { ...recordingMetadata(R1).analysis.analysis, ...fields }
})

const putAnalysis = (a: Signed, id: string, fields: AnalysisFields) =>
  api.put(
    'recordings',
    id,
    uploadBody(recordingMetadata(id, { analysis: analysis(fields) }), wav()),
    a
  )

async function keptAnalyses(a: Signed, first: AnalysisFields, second: AnalysisFields) {
  for (const [id, fields] of [
    [R1, first],
    [R2, second]
  ] as const) {
    expect((await putAnalysis(a, id, fields)).status).toBe(201)
  }
  return new Map((await library(a.cookie)).recordings.map(r => [r.id, r.analysis]))
}

async function expectRefusedAnalyses(a: Signed, refusedFields: AnalysisFields[]) {
  for (const fields of refusedFields) {
    const refused = await putAnalysis(a, R3, fields)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'invalid_request' })
  }
  expect(await rowsOf('recordings')).toEqual([`${a.id} ${R1}`, `${a.id} ${R2}`])
}

describe('the rows a route keeps', () => {
  it('are the browser’s Recording, with the audio’s size from R2', async () => {
    const a = await signUp('A')
    const audio = wav(0.1, 44_100)

    await api.put(
      'recordings',
      R1,
      uploadBody(
        recordingMetadata(R1, { sampleRate: 44_100, analysis: { state: 'notAnalyzed' } }),
        audio
      ),
      a
    )

    const [row] = await testDb().select().from(recordings).where(eq(recordings.userId, a.id))
    expect(row).toMatchObject({ id: R1, sampleRate: 44_100, analysis: null, deletedAt: null })
    expect(row.audioBytes).toBe((await media().head(`users/${a.id}/recordings/${R1}.wav`))?.size)
    expect((await library(a.cookie)).recordings).toMatchObject([
      { id: R1, analysis: { state: 'notAnalyzed' } }
    ])
  })

  it('keep the settle time (#116), and none when an older browser sends none', async () => {
    const a = await signUp('A')
    const kept = await keptAnalyses(a, { settleSeconds: 0.087 }, {})
    expect(kept.get(R1)).toEqual(analysis({ settleSeconds: 0.087 }))
    expect(kept.get(R2)).toEqual(analysis({}))
    expect(kept.get(R2)).not.toHaveProperty('analysis.settleSeconds')
    await expectRefusedAnalyses(
      a,
      ['0.1', -0.001, 3600.001].map(settleSeconds => ({ settleSeconds }))
    )
  })

  it('keep the analysis version (#208), and none when an older browser sends none', async () => {
    const a = await signUp('A')
    const kept = await keptAnalyses(
      a,
      { settleSeconds: 0.087, version: 3 },
      { settleSeconds: 0.087 }
    )
    expect(kept.get(R1)).toEqual(analysis({ settleSeconds: 0.087, version: 3 }))
    expect(kept.get(R2)).not.toHaveProperty('analysis.version')
    await expectRefusedAnalyses(
      a,
      ['3', 0, 2.5, 1001].map(version => ({ version }))
    )
  })
})
