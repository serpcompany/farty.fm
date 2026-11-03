import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { toots } from '@/db/schema'
import {
  api,
  library,
  padTootMetadata,
  rowsOf,
  signUp,
  T1,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

vi.mock('@/server/toot-payments', async original =>
  (await import('@/test-support/free-payments')).freeTootPayments(original)
)

const T2 = '44444444-4444-4444-8444-444444444444'

describe('Sound Pad Toots (ADR 0017)', () => {
  const pad = padTootMetadata(T1)
  const { performance } = pad
  const put = (metadata: unknown, cookie: string, id = T1) =>
    api.put('toots', id, uploadBody(metadata, wav()), { cookie })

  it('keep no Song and no Arrangement, and their Performance, as the browser sent them', async () => {
    const a = await signUp('A')
    expect((await put(pad, a.cookie)).status).toBe(201)
    const [row] = await testDb().select().from(toots).where(eq(toots.userId, a.id))
    expect(row).toMatchObject({ songId: null, arrangement: null, performance })
    expect((await library(a.cookie)).toots).toEqual([{ ...pad, audioBytes: row.audioBytes }])
  })

  it('keep only a Performance’s own fields', async () => {
    const a = await signUp('A')
    const more = { ...performance, more: 'x'.repeat(1000) }
    expect((await put(padTootMetadata(T1, { performance: more }), a.cookie)).status).toBe(201)
    const [row] = await testDb().select().from(toots).where(eq(toots.userId, a.id))
    expect(row.performance).toEqual(performance)
  })

  it('keep a Performance of 1000 taps, and one 30 s long', async () => {
    const a = await signUp('A')
    const taps = Array.from({ length: 1000 }, (_, i) => [i * 0.03, i % 2])
    const many = padTootMetadata(T1, { performance: { ...performance, taps } })
    expect((await put(many, a.cookie)).status).toBe(201)
    const long = padTootMetadata(T2, {
      performance: {
        ...performance,
        taps: [
          [0, 0],
          [30, 1]
        ]
      }
    })
    expect((await put(long, a.cookie, T2)).status).toBe(201)
  })

  it('refuse a Toot of both or neither, and a Performance this app can’t play (400)', async () => {
    const a = await signUp('A')
    const [r1, r2] = performance.recordings
    const playing = (fields: Record<string, unknown>) =>
      padTootMetadata(T1, { performance: { ...performance, ...fields } })
    const taps = (...list: unknown[]) => playing({ taps: list })
    const bothOrNeither = [
      tootMetadata(T1, { performance }),
      padTootMetadata(T1, { arrangement: tootMetadata(T1).arrangement }),
      padTootMetadata(T1, { performance: null }),
      padTootMetadata(T1, { songId: undefined })
    ]
    const badRecordings = [
      playing({ recordings: [], taps: [] }),
      taps(),
      playing({ recordings: ['not-a-recording', r2] }),
      playing({ recordings: [r1, r1] })
    ]
    const badTaps = [
      taps([0.5, 0], [0.25, 1]),
      taps([-0.001, 0], [0, 1]),
      taps([0, 0], [30.001, 1]),
      taps([0, 0], [0.25, 2]),
      taps([0, 0], [0.25, 0.5]),
      taps([0, 0], [0.25, 1, 2]),
      taps([0, 0], ['0.25', 1])
    ]
    const unplayedOrTooMany = [
      taps([0, 0], [0.25, 0]),
      playing({ taps: Array.from({ length: 1001 }, (_, i) => [i * 0.01, i % 2]) })
    ]
    for (const metadata of [...bothOrNeither, ...badRecordings, ...badTaps, ...unplayedOrTooMany]) {
      const response = await put(metadata, a.cookie)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    expect(await rowsOf('toots')).toEqual([])
  })
})
