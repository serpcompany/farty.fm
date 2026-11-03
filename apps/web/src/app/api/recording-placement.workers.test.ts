import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { recordings } from '@/db/schema'
import {
  api,
  library,
  nextD1Millisecond,
  R1,
  R2,
  recordingMetadata,
  signUp,
  testDb,
  upload,
  uploadBody,
  wav
} from '@/test-support/library-api'

describe('PATCH /api/recordings/{id}/ (ADR 0015)', () => {
  it('places a Recording on a note, moves it and takes it off, keeping its analysis', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    const before = await library(a.cookie)
    await nextD1Millisecond()

    const placed = await api.place(R1, 36, a)
    expect(placed.status).toBe(200)
    expect(await placed.json()).toEqual({ id: R1, placedPitch: 36 })
    const changes = await library(a.cookie, before.cursor)
    expect(changes.recordings).toEqual([
      { ...before.recordings[0], placedPitch: 36, audioBytes: expect.any(Number) }
    ])

    expect((await api.place(R1, 71, a)).status).toBe(200)
    expect((await library(a.cookie)).recordings).toMatchObject([{ id: R1, placedPitch: 71 }])
    const off = await api.place(R1, null, a)
    expect(await off.json()).toEqual({ id: R1, placedPitch: null })
    const [row] = await testDb().select().from(recordings).where(eq(recordings.userId, a.id))
    expect(row.placedPitch).toBeNull()
    expect(row.analysis).toEqual(recordingMetadata(R1).analysis.analysis)
  })

  it('refuses a note that is not a MIDI note (400), a deleted Recording (410), an unknown one (404) and another library (409)', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await upload('recordings', R1, a.cookie)

    for (const placedPitch of ['C2', 48.5, -2, 128, undefined]) {
      const refused = await api.place(R1, placedPitch, a)
      expect(refused.status, String(placedPitch)).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_request' })
    }
    expect((await api.place(R1, 48, a, 'not json')).status).toBe(400)
    const asB = await api.place(R1, 48, { cookie: a.cookie, library: b.id })
    expect(asB.status).toBe(409)
    expect((await api.place(R1, 48, b)).status).toBe(404)
    expect((await api.place('not-a-uuid', 48, a)).status).toBe(404)
    expect((await library(a.cookie)).recordings).toMatchObject([{ id: R1, placedPitch: null }])
    await api.delete('recordings', R1, a)
    expect((await api.place(R1, 48, a)).status).toBe(410)
    expect((await api.place(R2, 48, a)).status).toBe(404)
  })

  it('leaves a Recording out of Songs with "No note" (-1, #314)', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)

    const left = await api.place(R1, -1, a)
    expect(left.status).toBe(200)
    expect(await left.json()).toEqual({ id: R1, placedPitch: -1 })
    expect((await library(a.cookie)).recordings).toMatchObject([{ id: R1, placedPitch: -1 }])
  })
})

describe('PATCH /api/recordings/{id}/ with a name (#314)', () => {
  it('names a Recording beside its note and Trim, trims the name, and takes it off', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    const before = await library(a.cookie)
    await nextD1Millisecond()

    const named = await api.placeAndTrim(R1, { placedPitch: 40, name: '  Big one  ' }, a)
    expect(named.status).toBe(200)
    expect(await named.json()).toEqual({ id: R1, placedPitch: 40, name: 'Big one' })
    expect((await library(a.cookie, before.cursor)).recordings).toEqual([
      { ...before.recordings[0], placedPitch: 40, name: 'Big one', audioBytes: expect.any(Number) }
    ])

    expect((await api.place(R1, 41, a)).status).toBe(200)
    expect((await library(a.cookie)).recordings).toMatchObject([
      { placedPitch: 41, name: 'Big one' }
    ])
    expect(await (await api.placeAndTrim(R1, { name: '   ' }, a)).json()).toEqual({
      id: R1,
      name: null
    })
    expect((await api.placeAndTrim(R1, { name: 'Again' }, a)).status).toBe(200)
    expect((await api.placeAndTrim(R1, { name: null }, a)).status).toBe(200)
    const [row] = await testDb().select().from(recordings).where(eq(recordings.userId, a.id))
    expect([row.name, row.placedPitch]).toEqual([null, 41])
  })

  it('refuses a name that is not text or longer than 40 (400), and changes nothing', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await api.placeAndTrim(R1, { name: 'Kept' }, a)

    for (const name of [12, ['a'], 'x'.repeat(41), { name: 'a' }]) {
      const refused = await api.placeAndTrim(R1, { placedPitch: 40, name }, a)
      expect(refused.status, JSON.stringify(name)).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_request' })
    }
    expect((await library(a.cookie)).recordings).toMatchObject([
      { id: R1, placedPitch: null, name: 'Kept' }
    ])
    expect((await api.placeAndTrim(R1, { name: 'x'.repeat(40) }, a)).status).toBe(200)
  })
})

describe('PATCH /api/recordings/{id}/ with a Trim (ADR 0019)', () => {
  const fart = { startSeconds: 0.8868, endSeconds: 2.0821 }
  const trim = { startSeconds: 0.8, endSeconds: 2.3, fart }
  const uploadThreeSecondTake = (cookie: string) =>
    api.put('recordings', R1, uploadBody(recordingMetadata(R1, { seconds: 3 }), wav()), { cookie })

  it('trims a Recording beside its note, keeps either when the other changes, and takes it off', async () => {
    const a = await signUp('A')
    await uploadThreeSecondTake(a.cookie)
    const before = await library(a.cookie)
    await nextD1Millisecond()

    const trimmed = await api.placeAndTrim(R1, { placedPitch: 36, trim }, a)
    expect(trimmed.status).toBe(200)
    expect(await trimmed.json()).toEqual({ id: R1, placedPitch: 36, trim })
    expect((await library(a.cookie, before.cursor)).recordings).toEqual([
      { ...before.recordings[0], placedPitch: 36, trim, audioBytes: expect.any(Number) }
    ])

    expect((await api.place(R1, 40, a)).status).toBe(200)
    expect((await library(a.cookie)).recordings).toMatchObject([{ placedPitch: 40, trim }])
    expect((await api.placeAndTrim(R1, { trim: null }, a)).status).toBe(200)
    expect((await library(a.cookie)).recordings).toMatchObject([{ placedPitch: 40, trim: null }])
    const [row] = await testDb().select().from(recordings).where(eq(recordings.userId, a.id))
    expect([
      row.trimStartSeconds,
      row.trimEndSeconds,
      row.trimFartStartSeconds,
      row.trimFartEndSeconds
    ]).toEqual([null, null, null, null])
    expect(row.analysis).toEqual(recordingMetadata(R1).analysis.analysis)
  })

  it('refuses a Trim that is not a part of a take (400), and changes nothing', async () => {
    const a = await signUp('A')
    await uploadThreeSecondTake(a.cookie)

    const part = (startSeconds: unknown, endSeconds?: unknown) => ({
      startSeconds,
      endSeconds,
      fart: { startSeconds, endSeconds }
    })
    const fartMissing = { trim: { startSeconds: 0.2, endSeconds: 0.8 } }
    const fartOutside = (startSeconds: number, endSeconds: number) => ({
      trim: { ...part(0.2, 0.8), fart: { startSeconds, endSeconds } }
    })
    const pastTheTake = [{ trim: part(10, 11) }, { placedPitch: 36, trim: part(2, 3.02) }]
    for (const refused of [
      { trim: part(1, 1) },
      { trim: part(1.2, 0.4) },
      { trim: part(-0.1, 1) },
      { trim: part(0, 3601) },
      { trim: part('0', 1) },
      { trim: part(0) },
      { trim: [0, 1] },
      { trim: 1 },
      { placedPitch: 36, trim: part(1, 0) },
      fartMissing,
      fartOutside(0.1, 0.5),
      fartOutside(0.3, 0.9),
      fartOutside(0.5, 0.4),
      ...pastTheTake,
      {}
    ]) {
      const answer = await api.placeAndTrim(R1, refused, a)
      expect(answer.status, JSON.stringify(refused)).toBe(400)
      expect(await answer.json()).toEqual({ error: 'invalid_request' })
    }
    expect((await library(a.cookie)).recordings).toMatchObject([
      { id: R1, placedPitch: null, trim: null }
    ])
    const toTheLastSample = { ...part(2, 3.004), fart: { startSeconds: 2.1, endSeconds: 3.004 } }
    expect((await api.placeAndTrim(R1, { trim: toTheLastSample }, a)).status).toBe(200)
  })

  it('answers 404 and 410 for a Trim as for a Placed Pitch', async () => {
    const a = await signUp('A')
    await uploadThreeSecondTake(a.cookie)
    expect((await api.placeAndTrim(R2, { trim }, a)).status).toBe(404)
    expect((await api.delete('recordings', R1, a)).status).toBe(204)
    expect((await api.placeAndTrim(R1, { trim }, a)).status).toBe(410)
  })
})
