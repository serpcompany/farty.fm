import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Database } from './database'
import type { RecordingRow, TootRow } from './library'
import { handles, profileReports, recordings, shares, toots } from './schema'
import { playsAny, type TootPlays, takenDownRecordings } from './sharing'

// Profile pages in D1 (#319, ADR 0021): `/@<handle>/` lists what its user shares, and nothing
// else. A share that was stopped, taken down, or whose Recording, Toot or account was deleted
// isn't listed, the same as its own link doesn't work, and neither is a Toot that plays a
// Recording Farty took down (#346).

/** The user whose Handle is `handle`, as their page shows it, or null when no one has it. */
export async function profileUser(
  db: Database,
  handle: string
): Promise<{ userId: string; handle: string } | null> {
  const rows = await db
    .select({ userId: handles.userId, handle: handles.handle })
    .from(handles)
    .where(eq(handles.handle, handle))
  return rows[0] ?? null
}

/** A shared Recording or saved Toot on its owner's page. */
export type ProfileShareRow = { shareId: string; slug: string | null; sharedAt: Date } & (
  | { kind: 'recordings'; recording: RecordingRow }
  | {
      kind: 'toots'
      toot: Pick<TootRow, 'title' | 'songId' | 'seconds'> &
        TootPlays & {
          /**
           * The distinct pitches of the notes it saved, lowest first, as `rollOfScore` gives them,
           * for its farts' colors (#457). Null when it saved none.
           */
          scorePitches: number[] | null
        }
    }
)

/** Newest share first, and by link id when two were shared at once, as D1 would order them. */
const newestFirst = (a: ProfileShareRow, b: ProfileShareRow) =>
  b.sharedAt.getTime() - a.sharedAt.getTime() ||
  (a.shareId < b.shareId ? 1 : a.shareId > b.shareId ? -1 : 0)

/** Distinct pitches, lowest first, or null for none: a Toot that saved no notes. */
const lowestFirst = (pitches: number[]) =>
  pitches.length === 0 ? null : [...pitches].sort((a, b) => a - b)

/** The Recordings and Toots `userId` shares that work, newest share first. */
export async function profileShares(db: Database, userId: string): Promise<ProfileShareRow[]> {
  const live = (kind: 'recordings' | 'toots') =>
    and(eq(shares.userId, userId), eq(shares.kind, kind), isNull(shares.takenDownAt))
  // The take-downs come beside the shares. Each Toot's row carries the Recordings it plays, which
  // its row names (#448), so the check needs nothing more.
  const [recordingRows, tootRows, takenDown] = await Promise.all([
    db
      .select({
        shareId: shares.id,
        slug: shares.slug,
        sharedAt: shares.createdAt,
        recording: recordings
      })
      .from(shares)
      .innerJoin(
        recordings,
        and(eq(recordings.userId, shares.userId), eq(recordings.id, shares.itemId))
      )
      .where(and(live('recordings'), isNull(recordings.deletedAt))),
    db
      .select({
        shareId: shares.id,
        slug: shares.slug,
        sharedAt: shares.createdAt,
        title: toots.title,
        songId: toots.songId,
        seconds: toots.seconds,
        arrangement: toots.arrangement,
        // A Sound Pad Toot's Recordings only, never its taps, which can run to thousands.
        padRecordings: sql<string | null>`json_extract(${toots.performance}, '$.recordings')`,
        // Its saved notes' pitches only, never the notes, for its farts' colors (#457).
        scorePitches: sql<string>`(select json_group_array(distinct json_extract(note.value, '$.pitch')) from json_each(${toots.score}, '$.notes') as note)`
      })
      .from(shares)
      .innerJoin(toots, and(eq(toots.userId, shares.userId), eq(toots.id, shares.itemId)))
      .where(and(live('toots'), isNull(toots.deletedAt))),
    takenDownRecordings(db, userId)
  ])
  return [
    ...recordingRows.map(row => ({ kind: 'recordings' as const, ...row })),
    ...tootRows
      .map(({ shareId, slug, sharedAt, padRecordings, scorePitches, ...toot }) => ({
        kind: 'toots' as const,
        shareId,
        slug,
        sharedAt,
        toot: {
          ...toot,
          performance:
            padRecordings === null ? null : { recordings: JSON.parse(padRecordings) as string[] },
          scorePitches: lowestFirst(JSON.parse(scorePitches ?? '[]') as number[])
        }
      }))
      .filter(row => !playsAny(row.toot, takenDown))
  ].sort(newestFirst)
}

/** Keeps a report of `userId`'s page for Farty to check. */
export async function addProfileReport(db: Database, userId: string, id: string, now: Date) {
  await db.insert(profileReports).values({ id, userId, createdAt: now })
}
