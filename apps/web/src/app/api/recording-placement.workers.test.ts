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
  upload
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

    for (const placedPitch of ['C2', 48.5, -1, 128, undefined]) {
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
})
