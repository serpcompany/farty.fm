import { addSongReport } from '@/db/song-reports'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { servedOrigin } from '@/lib/site'
import { isSongReportReason, SONG_REPORT_NOTE_MAX, type SongReportReason } from '@/lib/song-report'

import { consumeSlots, keyedHash, requestClient } from './auth-config'
import type { Stores } from './library'
import { readJson } from './library-input'
import { apiError } from './require-user'
import { REPORT_LIMITS } from './sharing'

// Report a problem with a Song (#358): anyone's report that a catalog Song is wrong, guests' too,
// for Farty to fix the catalog by (docs/agents/web.md, Reports and take-downs). The limits are
// share Reports' (`REPORT_LIMITS`, ADR 0020), in rows of their own, so a flood of Song reports
// never spends the slots that keep a shared link or a page reportable.

/** The site's one row for Song reports. */
export const SITE_SONG_REPORTS_KEY = 'song_report'

/** A reporter's row for Song reports an hour: an HMAC of their client address, as every key is. */
async function songReporterLimitKey(secret: string, client: string): Promise<string> {
  return `song-reporter|${await keyedHash(secret, 'song-reporter-limit', client)}`
}

/** A Song's row for its reports a day, whichever of its notes they're about. */
export const songReportsKey = (songId: string) => `song_report_song|${songId}`

/** A report's body, checked: a known reason, the notes it's about, and the note, if any. */
export type SongReportBody = { reason: SongReportReason; version: string; note: string | null }

/**
 * The report in `json`, or the error that refuses it: `invalid_request` for anything but a known
 * reason and the 16 hex digits of a notes file's name (`songVersion`), and `note_too_long` for a
 * note longer than `SONG_REPORT_NOTE_MAX`. A note of only spaces is no note.
 */
export function parseSongReport(json: unknown): SongReportBody | { error: string } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { error: 'invalid_request' }
  }
  const { reason, version, note = null } = json as Record<string, unknown>
  if (!isSongReportReason(reason)) return { error: 'invalid_request' }
  if (typeof version !== 'string' || !/^[0-9a-f]{16}$/.test(version)) {
    return { error: 'invalid_request' }
  }
  if (note !== null && typeof note !== 'string') return { error: 'invalid_request' }
  if (note !== null && note.length > SONG_REPORT_NOTE_MAX) return { error: 'note_too_long' }
  return { reason, version, note: note?.trim() || null }
}

/**
 * `POST /api/songs/<id>/report/`: anyone's report that a Song is wrong, as JSON
 * (`SongReportBody`). It keeps a `song_reports` row with the Song, the notes' version, the reason
 * and the note, never the reporter, and logs `song_reported` with the Song, version and reason
 * (not the note). 204 once kept; 403 from another site, 404 for a Song this build doesn't ship,
 * 415, 413 or 400 for a body that isn't a report (`parseSongReport`), 429 `too_many_reports` past
 * any of `REPORT_LIMITS`: per reporter, keyed by an HMAC of their `cf-connecting-ip` under
 * `secret`, never the address; per Song; and for the site. A report spends a slot of each only
 * when all three have one.
 */
export async function reportSong(
  { db }: Stores,
  request: Request,
  songId: string,
  secret: string
): Promise<Response> {
  if (request.headers.get('origin') !== servedOrigin(request)) {
    return apiError(403, 'cross_origin')
  }
  const song = songIndex.find(s => s.id === songId)
  if (!song) return apiError(404, 'not_found')
  const body = await readJson(request)
  if (body instanceof Response) return body
  const report = parseSongReport(body.json)
  if ('error' in report) return apiError(400, report.error)
  const now = Date.now()
  const allowed = await consumeSlots(
    db.$client,
    [
      {
        key: await songReporterLimitKey(secret, requestClient(request)),
        rule: REPORT_LIMITS.perReporter
      },
      { key: songReportsKey(song.id), rule: REPORT_LIMITS.perItem },
      { key: SITE_SONG_REPORTS_KEY, rule: REPORT_LIMITS.siteWide }
    ],
    now
  )
  if (!allowed) return apiError(429, 'too_many_reports')
  await addSongReport(db, {
    id: crypto.randomUUID(),
    songId: song.id,
    songVersion: report.version,
    reason: report.reason,
    note: report.note,
    createdAt: new Date(now)
  })
  console.warn(
    JSON.stringify({
      event: 'song_reported',
      songId: song.id,
      version: report.version,
      reason: report.reason
    })
  )
  return new Response(null, { status: 204 })
}
