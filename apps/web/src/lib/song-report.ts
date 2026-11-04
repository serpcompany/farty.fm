import type { SongSummary } from './catalog/song'

// Report a problem with a Song (#358): anyone, guests too, tells Farty a catalog Song is wrong,
// from the end of Song Creator or a locked Song's sheet. Each report is a `song_reports` row in D1
// with the Song, the notes it was sent about, the reason and the note, and nothing about who sent
// it (`src/server/song-reports.ts`). `tools/catalog/song_reports.py` lists them per Song, worst
// first, for catalog fixes (docs/agents/web.md, Reports and take-downs).

/** What can be wrong with a Song, in the report sheet's order: the id D1 keeps, and its label. */
export const SONG_REPORT_REASONS = [
  { id: 'wrong_notes', label: 'Missing or wrong notes' },
  { id: 'wrong_sound', label: "Doesn't sound like this Song" },
  { id: 'wrong_title', label: 'Wrong title or composer' },
  { id: 'other', label: 'Something else' }
] as const

export type SongReportReason = (typeof SONG_REPORT_REASONS)[number]['id']

/** The ids of `SONG_REPORT_REASONS`, which `song_reports.reason` holds. */
export const SONG_REPORT_REASON_IDS = SONG_REPORT_REASONS.map(reason => reason.id) as [
  SongReportReason,
  ...SongReportReason[]
]

export const isSongReportReason = (value: unknown): value is SongReportReason =>
  SONG_REPORT_REASON_IDS.includes(value as SongReportReason)

/** The longest note a report keeps, in UTF-16 code units, as the textarea's `maxLength` counts. */
export const SONG_REPORT_NOTE_MAX = 500

/**
 * Which of a Song's melodies a report is about: the 16 hex digits its notes file is named by
 * (`notesPath`, `generate.ts`), which change whenever its notes do. So a report sent before a fix
 * can be told from one about the fixed notes. Empty for a path of any other shape.
 */
export function songVersion(song: Pick<SongSummary, 'notesPath'>): string {
  return /-([0-9a-f]{16})\.json$/.exec(song.notesPath)?.[1] ?? ''
}

/** How sending a report went: kept, refused past a limit, or anything else. */
export type SongReportResult = 'sent' | 'limited' | 'failed'

/** Sends a report of `song` to `POST /api/songs/<id>/report/`. Never throws. */
export async function sendSongReport(
  song: Pick<SongSummary, 'id' | 'notesPath'>,
  reason: SongReportReason,
  note: string
): Promise<SongReportResult> {
  const response = await fetch(`/api/songs/${encodeURIComponent(song.id)}/report/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason, note, version: songVersion(song) })
  }).catch(() => null)
  return response?.ok ? 'sent' : response?.status === 429 ? 'limited' : 'failed'
}
