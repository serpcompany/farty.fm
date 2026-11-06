import type { Database } from '@/db/database'
import type { Kind } from '@/db/library'
import { addProfileReport, type ProfileShareRow, profileShares, profileUser } from '@/db/profiles'
import { liveRecordingsOf, sharedToot, tootRecordingIds } from '@/db/sharing'
import { noteName } from '@/lib/pitch'
import { formattedFartSeconds } from '@/lib/pitch-coverage'
import { recordingName, songPitch } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'
import { formattedTootLength, type TootRoll } from '@/lib/toot'

import { consumeSlots, reporterLimitKey, requestClient } from './auth-config'
import { type Stores, toRecording } from './library'
import { apiError } from './require-user'
import {
  giveSlugs,
  partBars,
  REPORT_LIMITS,
  SITE_REPORTS_KEY,
  sharedPart,
  sharedTootRoll,
  sharePath,
  tootSongTitle
} from './sharing'

// Profile pages (#319, ADR 0021): `/@<handle>/`, public, which lists only what its user shares,
// Toots and Recordings (#346) under a tab each (#448), newest first, each playing in place and
// linking to its own shared page, under a banner of the newest Toot's note roll, with Add friend
// and Report. No counts and no feed.

/** A shared Recording or Toot, as its owner's page lists it: nothing private, and its link. */
export type ProfileItem = {
  kind: Kind
  /** Its shared page, `/@<handle>/r/<slug>/` or `/@<handle>/t/<slug>/`, which its audio is under. */
  path: string
  /** "Recording 8", or a Toot's title. */
  name: string
  /**
   * A Recording's note, "E3", or null for a Noise-like one. A Toot's Song, "Twinkle, Twinkle,
   * Little Star", or "Sound Pad", or null when that's its name, or the Song isn't in Farty any more.
   */
  detail: string | null
  /** When it was shared, in ms, for the page to say "Today" in the viewer's own time zone. */
  sharedAt: number
  /**
   * How long `seconds` is: "1.4 s", the part a Recording's link serves, rounded down, or "0:18", a
   * Toot. The time its row shows while it plays never passes it.
   */
  length: string
  /** How long the audio its link serves is, in seconds: what its row plays and draws, from 0. */
  seconds: number
  /**
   * A Recording's loudness bars, each 0…1, of the part its link serves, from its upload. Empty for
   * a Toot, whose bars are drawn from its saved WAV: its row fetches them with its roll (`row/`),
   * so the page never reads every Toot's audio.
   */
  levels: number[]
  /** The names of the farts a Toot plays, as its page lists them, leaving out any deleted. */
  farts: string[]
}

/**
 * The newest shared Toot's note roll, which the page's banner draws and plays (#448), as that
 * Toot's own page draws it: only its notes, nothing of its farts.
 */
export type ProfileHero = TootRoll & {
  /** Its row's `path`. */
  path: string
}

export type Profile = { handle: string; items: ProfileItem[]; hero: ProfileHero | null }

/** A Handle from a link: lowercased, and only one that could be someone's, by its shape. */
function linkHandle(handle: string): string | null {
  const lower = handle.toLowerCase()
  // The shape only: a Handle the block list gained since it was picked still finds its page.
  return /^[a-z0-9_]{3,20}$/.test(lower) ? lower : null
}

/** The user at `/@<handle>/`, or null when no one has that Handle, or their account is gone. */
async function profileOwner(db: Database, handle: string) {
  const lower = linkHandle(handle)
  return lower === null ? null : profileUser(db, lower)
}

/** A share's name and detail on its row: a Recording's name and note, or a Toot's title and Song. */
function itemText(row: ProfileShareRow): { name: string; detail: string | null } {
  if (row.kind === 'toots') {
    const song = tootSongTitle(row.toot.songId)
    return { name: row.toot.title, detail: song === row.toot.title ? null : song }
  }
  const recording = toRecording(row.recording)
  const pitch = songPitch(recording)
  return { name: recordingName(recording), detail: pitch === null ? null : noteName(pitch) }
}

/** What a share's row plays and draws, and the farts a Toot's row names, from `fartNames`. */
function itemSound(
  row: ProfileShareRow,
  fartNames: Map<string, string>
): Pick<ProfileItem, 'length' | 'seconds' | 'levels' | 'farts'> {
  if (row.kind === 'toots') {
    return {
      length: formattedTootLength(row.toot.seconds),
      seconds: row.toot.seconds,
      levels: [],
      farts: tootRecordingIds(row.toot).flatMap(id => fartNames.get(id) ?? [])
    }
  }
  const recording = toRecording(row.recording)
  const part = sharedPart(recording)
  // What its link serves and its own page plays: the waveform, Play and the time on it all cover
  // this, so its length does too, and the time never runs past it.
  const seconds = part.endSeconds - part.startSeconds
  return {
    length: formattedFartSeconds(seconds),
    seconds,
    levels: partBars(recording.waveform, recording.seconds, part),
    farts: []
  }
}

/** The names of the Recordings `rows`' Toots play that aren't deleted, by id, in one lookup. */
async function tootFartNames(
  db: Database,
  userId: string,
  rows: ProfileShareRow[]
): Promise<Map<string, string>> {
  const ids = new Set(rows.flatMap(row => (row.kind === 'toots' ? tootRecordingIds(row.toot) : [])))
  if (ids.size === 0) return new Map()
  const found = await liveRecordingsOf(db, userId, [...ids])
  return new Map(found.map(row => [row.id, recordingName(toRecording(row))]))
}

/** The banner's roll: the Toot's at `slug`, as its own page finds and draws it. */
async function heroOf(db: Database, handle: string, slug: string): Promise<ProfileHero | null> {
  const row = await sharedToot(db, handle, slug)
  if (!row) return null
  return {
    path: sharePath('toots', handle, slug),
    ...(await sharedTootRoll(db, { row }))
  }
}

/**
 * The page at `/@<handle>/`: the Handle, the Recordings and Toots shared under it that work, and
 * the newest Toot's roll for its banner.
 */
export async function findProfile(db: Database, handle: string): Promise<Profile | null> {
  const owner = await profileOwner(db, handle)
  if (!owner) return null
  let rows = await profileShares(db, owner.userId)
  if (rows.some(row => row.slug === null)) {
    await giveSlugs(db, owner.userId)
    rows = await profileShares(db, owner.userId)
  }
  const fartNames = await tootFartNames(db, owner.userId, rows)
  const newest = rows.find(row => row.kind === 'toots')
  return {
    handle: owner.handle,
    items: rows.map(row => ({
      kind: row.kind,
      path: sharePath(row.kind, owner.handle, row.slug ?? row.shareId),
      ...itemText(row),
      sharedAt: row.sharedAt.getTime(),
      ...itemSound(row, fartNames)
    })),
    hero: newest ? await heroOf(db, owner.handle, newest.slug ?? newest.shareId) : null
  }
}

/** A user's row for reports of their page a day, as a shared item's (`itemReportsKey`). */
export const profileReportsKey = (userId: string) => `profile_report|${userId}`

/**
 * `POST /@<handle>/report/`: anyone's report of a profile page, such as for its Handle. It keeps
 * a row in `profile_reports` naming the user, never the reporter, and logs `profile_reported`
 * with the Handle, for Farty to check (docs/agents/web.md). 204 once kept; 403 from another site,
 * 404 when no one has the Handle, 429 `too_many_reports` past `REPORT_LIMITS`: the reporter's
 * slots and the site's are the ones shared pages' reports spend, and each page has its own day's.
 */
export async function reportProfile(
  { db }: Stores,
  request: Request,
  handle: string,
  secret: string
): Promise<Response> {
  if (request.headers.get('origin') !== servedOrigin(request)) {
    return apiError(403, 'cross_origin')
  }
  const owner = await profileOwner(db, handle)
  if (!owner) return apiError(404, 'not_found')
  const now = Date.now()
  const allowed = await consumeSlots(
    db.$client,
    [
      {
        key: await reporterLimitKey(secret, requestClient(request)),
        rule: REPORT_LIMITS.perReporter
      },
      { key: profileReportsKey(owner.userId), rule: REPORT_LIMITS.perItem },
      { key: SITE_REPORTS_KEY, rule: REPORT_LIMITS.siteWide }
    ],
    now
  )
  if (!allowed) return apiError(429, 'too_many_reports')
  await addProfileReport(db, owner.userId, crypto.randomUUID(), new Date(now))
  console.warn(JSON.stringify({ event: 'profile_reported', handle: owner.handle }))
  return new Response(null, { status: 204 })
}
