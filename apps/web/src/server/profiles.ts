import type { Database } from '@/db/database'
import type { Kind } from '@/db/library'
import { addProfileReport, type ProfileShareRow, profileShares, profileUser } from '@/db/profiles'
import { sharedToot } from '@/db/sharing'
import { nearestNote, noteName } from '@/lib/pitch'
import { recordingName, songPitch, type Trim } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'
import { formattedTootLength, type TootRoll } from '@/lib/toot'

import { consumeSlots, reporterLimitKey, requestClient } from './auth-config'
import { type Stores, toRecording } from './library'
import { apiError } from './require-user'
import {
  giveSlugs,
  partBars,
  REPORT_LIMITS,
  recordingFart,
  SITE_REPORTS_KEY,
  sharedTootRoll,
  sharePath,
  tootFartRows,
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
   * "1.1 s", a Recording's fart's length, the span its row plays, as its own page prints it
   * (`recordingFart`, #450), or "0:18", a Toot's. The time its row shows while it plays never
   * passes it.
   */
  length: string
  /**
   * What its row plays, draws and times, in seconds of the audio its link serves: a Recording's
   * fart, without the silence around it in what its link serves (a trim, ADR 0004), or a whole
   * Toot. Where a fart lies in its own audio says nothing that audio doesn't.
   */
  part: Trim
  /**
   * A Recording's loudness bars, each 0…1, of its fart, from its upload. Empty for a Toot, whose
   * bars are drawn from its saved WAV: its row fetches them (`row/`), so the page
   * never reads every Toot's audio.
   */
  levels: number[]
  /**
   * A Recording's note, as a whole MIDI note number, which its row draws as a line across its
   * waveform (#459): the note `detail` names, no finer, or null for a Noise-like one placed by no
   * ear. Null for a Toot, whose notes its row fetches with its bars (`row/`).
   */
  pitch: number | null
  /**
   * How many farts it plays, which its row counts (#457): a Toot's "Recordings used" rows, a
   * deleted Recording's too, or a Recording's 1.
   */
  farts: number
  /**
   * The colors (`pitchColor`) of its first `ROW_DOTS` farts, in order, which its row draws as
   * dots: a Toot's "Recordings used" rows', from the one function that colors them
   * (`tootFartRows`), so they match its own page; a Recording's, the first color. Only a place
   * among its pitches: never a fart's name, where it was made or a Recording's id (ADR 0020).
   */
  fartColors: number[]
}

/** The most dots a row draws for its farts (#457). Its count still says them all. */
export const ROW_DOTS = 16

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

/** What a share's row plays and draws. */
function itemSound(
  row: ProfileShareRow
): Pick<ProfileItem, 'length' | 'part' | 'levels' | 'pitch'> {
  if (row.kind === 'toots') {
    return {
      length: formattedTootLength(row.toot.seconds),
      part: { startSeconds: 0, endSeconds: row.toot.seconds },
      levels: [],
      pitch: null
    }
  }
  const recording = toRecording(row.recording)
  // Its fart inside what its link serves. The waveform, Play and the time on it cover only this,
  // and its length is this span's, as its own page prints it (#450).
  const { inTake, part, length } = recordingFart(recording)
  return {
    length,
    part,
    levels: partBars(recording.waveform, recording.seconds, inTake),
    pitch: rowPitch(songPitch(recording))
  }
}

/** A Recording's pitch as its row draws it: the nearest note, the one its pill names, no finer. */
const rowPitch = (pitch: number | null) => (pitch === null ? null : nearestNote(pitch))

/** A share's farts, as its row's dots and count (#457). */
function itemFarts(row: ProfileShareRow): Pick<ProfileItem, 'farts' | 'fartColors'> {
  if (row.kind === 'recordings') return { farts: 1, fartColors: [0] }
  const colors = tootFartRows(row.toot, row.toot.scorePitches).map(fart => fart.colorIndex)
  return { farts: colors.length, fartColors: colors.slice(0, ROW_DOTS) }
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
  const newest = rows.find(row => row.kind === 'toots')
  return {
    handle: owner.handle,
    items: rows.map(row => ({
      kind: row.kind,
      path: sharePath(row.kind, owner.handle, row.slug ?? row.shareId),
      ...itemText(row),
      sharedAt: row.sharedAt.getTime(),
      ...itemSound(row),
      ...itemFarts(row)
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
