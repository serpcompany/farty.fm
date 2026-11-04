import type { Database } from './database'
import { songReports } from './schema'

/** A Song report as D1 keeps it (#358): the Song, its notes' version, the reason and the note. */
export type NewSongReport = typeof songReports.$inferInsert

/** Keeps a report of a catalog Song for Farty to fix it by. */
export async function addSongReport(db: Database, report: NewSongReport) {
  await db.insert(songReports).values(report)
}
