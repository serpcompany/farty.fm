import type { Database } from '@/db/database'
import type { Kind } from '@/db/library'
import { addProfileReport, type ProfileShareRow, profileShares, profileUser } from '@/db/profiles'
import { noteName } from '@/lib/pitch'
import { recordingName, songPitch } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'

import { consumeSlots, reporterLimitKey, requestClient } from './auth-config'
import { type Stores, toRecording } from './library'
import { apiError } from './require-user'
import { giveSlugs, REPORT_LIMITS, SITE_REPORTS_KEY, sharePath, tootSongTitle } from './sharing'

// Profile pages (#319, ADR 0021): `/@<handle>/`, public, which lists only what its user shares,
// Recordings and Toots (#346) together, newest first, each linking to its own shared page, with
// Add friend and Report. No counts and no feed.

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
}

export type Profile = { handle: string; items: ProfileItem[] }

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

/** The page at `/@<handle>/`: the Handle and the Recordings and Toots shared under it that work. */
export async function findProfile(db: Database, handle: string): Promise<Profile | null> {
  const owner = await profileOwner(db, handle)
  if (!owner) return null
  let rows = await profileShares(db, owner.userId)
  if (rows.some(row => row.slug === null)) {
    await giveSlugs(db, owner.userId)
    rows = await profileShares(db, owner.userId)
  }
  return {
    handle: owner.handle,
    items: rows.map(row => ({
      kind: row.kind,
      path: sharePath(row.kind, owner.handle, row.slug ?? row.shareId),
      ...itemText(row),
      sharedAt: row.sharedAt.getTime()
    }))
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
