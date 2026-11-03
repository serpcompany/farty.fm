import type { Database } from '@/db/database'
import type { Kind } from '@/db/library'
import { addProfileReport, type ProfileShareRow, profileShares, profileUser } from '@/db/profiles'
import { noteName } from '@/lib/pitch'
import { recordingName, songPitch } from '@/lib/recordings'

import { apiError, notFound } from './http'
import { type Stores, toRecording } from './library'
import { crossOriginReport, spendReportSlots } from './reports'
import { HANDLE_SHAPE, sharePath, tootSongTitle } from './sharing'

type ProfileItem = {
  kind: Kind
  shareId: string
  path: string
  name: string
  detail: string | null
  sharedAt: number
}

export type Profile = { handle: string; items: ProfileItem[] }

async function profileOwner(db: Database, handle: string) {
  const lower = handle.toLowerCase()
  return HANDLE_SHAPE.test(lower) ? profileUser(db, lower) : null
}

function itemText(row: ProfileShareRow): { name: string; detail: string | null } {
  if (row.kind === 'toots') {
    return { name: row.toot.title, detail: tootSongTitle(row.toot.songId) }
  }
  const recording = toRecording(row.recording)
  const pitch = songPitch(recording)
  return { name: recordingName(recording), detail: pitch === null ? null : noteName(pitch) }
}

export async function findProfile(db: Database, handle: string): Promise<Profile | null> {
  const owner = await profileOwner(db, handle)
  if (!owner) return null
  const rows = await profileShares(db, owner.userId)
  return {
    handle: owner.handle,
    items: rows.map(row => ({
      kind: row.kind,
      shareId: row.shareId,
      path: sharePath(row.kind, owner.handle, row.shareId),
      ...itemText(row),
      sharedAt: row.sharedAt.getTime()
    }))
  }
}

const profileReportsKey = (userId: string) => `profile_report|${userId}`

export async function reportProfile(
  { db }: Stores,
  request: Request,
  handle: string,
  secret: string
): Promise<Response> {
  const crossOrigin = crossOriginReport(request)
  if (crossOrigin) return crossOrigin
  const owner = await profileOwner(db, handle)
  if (!owner) return notFound()
  const now = Date.now()
  if (!(await spendReportSlots(db, request, secret, profileReportsKey(owner.userId), now))) {
    return apiError(429, 'too_many_reports')
  }
  await addProfileReport(db, owner.userId, crypto.randomUUID(), new Date(now))
  console.warn(JSON.stringify({ event: 'profile_reported', handle: owner.handle }))
  return new Response(null, { status: 204 })
}
