import { eq, like } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { rateLimit, songReports } from '@/db/schema'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { SONG_REPORT_NOTE_MAX, SONG_REPORT_REASONS, songVersion } from '@/lib/song-report'
import { ORIGIN, signUp, testDb } from '@/test-support/library-api'

import * as reportRoute from './[id]/report/route'

// Report a problem with a Song (#358) in workerd, with a real D1: anyone's report, guests' too,
// kept as a `song_reports` row with nothing about who sent it, from this site only, and within
// share Reports' limits (`REPORT_LIMITS`, ADR 0020) in rows of its own.

const [twinkle, mary, jingle] = songIndex
const version = (song = twinkle) => songVersion(song)

type From = { origin?: string | null; ip?: string | null; cookie?: string; type?: string }

/** A report as Song Creator's or a locked sheet's Send sends it, from `ip` on this site. */
function report(
  songId: string,
  body: unknown,
  { origin = ORIGIN, ip = '203.0.113.1', cookie, type = 'application/json' }: From = {}
) {
  const headers = new Headers({ 'content-type': type })
  if (origin !== null) headers.set('origin', origin)
  if (ip !== null) headers.set('cf-connecting-ip', ip)
  if (cookie) headers.set('cookie', cookie)
  return reportRoute.POST(
    new Request(`${ORIGIN}/api/songs/${songId}/report/`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: songId }) }
  )
}

const aReport = (song = twinkle, note = '') => ({
  reason: 'wrong_notes',
  note,
  version: version(song)
})

const kept = () => testDb().select().from(songReports)

/** The slots spent of each `rate_limit` row whose key is `LIKE` `pattern`. */
async function slotsLike(pattern: string): Promise<number[]> {
  const rows = await testDb()
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(like(rateLimit.key, pattern))
  return rows.map(row => row.count)
}

/** Every `rate_limit` row's key. */
const limitKeys = async () =>
  (await testDb().select({ key: rateLimit.key }).from(rateLimit)).map(row => row.key)

afterEach(() => {
  vi.restoreAllMocks()
})

describe("Reporting a Song that's wrong", () => {
  it('keeps each reason with the Song, its notes and the note, and nothing about the reporter', async () => {
    for (const [i, { id: reason }] of SONG_REPORT_REASONS.entries()) {
      const response = await report(
        twinkle.id,
        { reason, note: `Note ${i}`, version: version() },
        { ip: `203.0.113.${i}` }
      )
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
    const rows = await kept()
    expect(rows).toEqual(
      SONG_REPORT_REASONS.map(({ id: reason }, i) => ({
        id: expect.any(String),
        songId: twinkle.id,
        songVersion: version(),
        reason,
        note: `Note ${i}`,
        createdAt: expect.any(Date)
      }))
    )
    // The reporters' rows hold an HMAC, never their address.
    expect((await limitKeys()).join(' ')).not.toMatch(/203\.0\.113/)
  })

  it("takes a guest's report, and a signed-in one keeps no more of its account", async () => {
    expect((await report(twinkle.id, aReport())).status).toBe(204)
    const alice = await signUp('alice')
    expect((await report(mary.id, aReport(mary), { cookie: alice.cookie })).status).toBe(204)
    const rows = await kept()
    expect(rows.map(row => row.songId).sort()).toEqual([mary.id, twinkle.id].sort())
    expect(JSON.stringify(rows)).not.toMatch(/alice/)
  })

  it('keeps a note of up to 500 characters, trimmed, and no note when it is only spaces', async () => {
    const longest = 'x'.repeat(SONG_REPORT_NOTE_MAX)
    expect(
      (await report(twinkle.id, aReport(twinkle, longest), { ip: '203.0.113.1' })).status
    ).toBe(204)
    expect(
      (await report(twinkle.id, aReport(twinkle, '  Bar 3 \n'), { ip: '203.0.113.2' })).status
    ).toBe(204)
    expect((await report(twinkle.id, aReport(twinkle, '   '), { ip: '203.0.113.3' })).status).toBe(
      204
    )
    const { note: _, ...noNote } = aReport()
    expect((await report(twinkle.id, noNote, { ip: '203.0.113.4' })).status).toBe(204)
    expect((await kept()).map(row => row.note)).toEqual([longest, 'Bar 3', null, null])
  })

  it('refuses a note that is too long, and spends no slot', async () => {
    const response = await report(
      twinkle.id,
      aReport(twinkle, 'x'.repeat(SONG_REPORT_NOTE_MAX + 1))
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'note_too_long' })
    expect(await kept()).toEqual([])
    expect(await limitKeys()).toEqual([])
  })

  it('refuses anything but a known reason, a notes version and a text note', async () => {
    for (const body of [
      { ...aReport(), reason: 'bad' },
      { ...aReport(), reason: undefined },
      { ...aReport(), version: 'abc' },
      { ...aReport(), version: undefined },
      { ...aReport(), note: 5 },
      [aReport()],
      'null'
    ]) {
      const response = await report(twinkle.id, body)
      expect([body, response.status]).toEqual([body, 400])
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    expect((await report(twinkle.id, '{', {})).status).toBe(400)
    expect((await report(twinkle.id, aReport(), { type: 'text/plain' })).status).toBe(415)
    const huge = { ...aReport(), padding: 'x'.repeat(17 * 1024) }
    expect((await report(twinkle.id, huge)).status).toBe(413)
    expect(await kept()).toEqual([])
    expect(await limitKeys()).toEqual([])
  })

  it("answers 404 for a Song this build doesn't ship", async () => {
    for (const id of ['not-a-song', 'ode-mutopia']) {
      expect((await report(id, aReport())).status).toBe(404)
    }
    expect(await kept()).toEqual([])
  })

  it('is refused from another site, or with no origin, and spends no slot', async () => {
    for (const origin of ['https://evil.example', null]) {
      const response = await report(twinkle.id, aReport(), { origin })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'cross_origin' })
    }
    expect(await kept()).toEqual([])
    expect(await limitKeys()).toEqual([])
  })

  it('logs song_reported with the Song, its notes and the reason, never the note', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await report(twinkle.id, aReport(twinkle, 'my secret note'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      event: 'song_reported',
      songId: twinkle.id,
      version: version(),
      reason: 'wrong_notes'
    })
  })
})

describe('Song report limits', () => {
  it('keeps a few reports a day per Song, and answers 429 past them, spending nothing', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await report(twinkle.id, aReport(), { ip: `203.0.113.${i}` })).status).toBe(204)
    }
    const refused = await report(twinkle.id, aReport(), { ip: '203.0.113.9' })
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: 'too_many_reports' })
    expect(await kept()).toHaveLength(5)
    // The refused report spent nothing: not the site's, nor its reporter's.
    expect(await slotsLike('song_report')).toEqual([5])
    expect(await slotsLike('song-reporter|%')).toEqual([1, 1, 1, 1, 1])
    // Another Song still takes reports.
    expect((await report(mary.id, aReport(mary), { ip: '203.0.113.9' })).status).toBe(204)
  })

  it('keeps a few reports an hour per reporter, so one client cannot spend the site', async () => {
    for (const song of [twinkle, mary]) {
      for (let i = 0; i < 5; i++) expect((await report(song.id, aReport(song))).status).toBe(204)
    }
    // The same client's 11th report this hour is refused, and spends none of Jingle Bells'.
    expect((await report(jingle.id, aReport(jingle))).status).toBe(429)
    expect(await slotsLike(`song_report_song|${jingle.id}`)).toEqual([])
    expect(await slotsLike('song_report')).toEqual([10])
    // Anyone else's report of it still counts, and a report with no address shares one bucket.
    expect((await report(jingle.id, aReport(jingle), { ip: '198.51.100.7' })).status).toBe(204)
    expect((await report(jingle.id, aReport(jingle), { ip: null })).status).toBe(204)
    expect(await kept()).toHaveLength(12)
  })

  it("answers 429 when the site has had too many, and spends no Song's or reporter's slot", async () => {
    const now = Date.now()
    await testDb()
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: 'song_report',
        count: 300,
        lastRequest: now + 60 * 60 * 1000
      })
    expect((await report(twinkle.id, aReport())).status).toBe(429)
    expect(await kept()).toEqual([])
    expect(await slotsLike('song_report_song|%')).toEqual([])
    expect(await slotsLike('song-reporter|%')).toEqual([])

    // Once the site's hour is over, reports are kept again.
    await testDb()
      .update(rateLimit)
      .set({ lastRequest: now - 1 })
      .where(eq(rateLimit.key, 'song_report'))
    expect((await report(twinkle.id, aReport())).status).toBe(204)
  })

  it("never spends the slots of shared links' and pages' Reports", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await report(twinkle.id, aReport(), { ip: '203.0.113.1' })).status).toBe(204)
    }
    expect(await slotsLike('share_report%')).toEqual([])
    expect(await slotsLike('share-reporter|%')).toEqual([])
    expect(await slotsLike('profile_report%')).toEqual([])
  })
})
