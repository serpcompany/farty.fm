import { z } from 'zod'

import type { Database } from '@/db/database'
import { itemStatus, type Kind } from '@/db/library'
import {
  addShare,
  claimHandle,
  emailOf,
  handleOf,
  handleTaken,
  liveShares,
  removeShare,
  type SharedRecordingRow,
  type SharedTootRow,
  sharedRecording,
  sharedToot,
  shareOf,
  tootPlaysTakenDown
} from '@/db/sharing'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { handleProblem, normalizeHandle, suggestHandle } from '@/lib/handle'
import type { Recording, Trim } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'
import { PAD_TOOT_TITLE } from '@/lib/toot'

import type { SessionUser } from './auth-session'
import { apiError, gone, notFound } from './http'
import { refusedItemRequest, type Stores, toRecording } from './library'
import { readJson } from './library-input'
import { audioKey } from './media'

const SHARE_ID = /^[0-9a-hjkmnp-tv-z]{12}$/
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export const HANDLE_SHAPE = /^[a-z0-9_]{3,20}$/

function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, byte => ALPHABET[byte & 31]).join('')
}

const LINK_SEGMENT: Record<Kind, string> = { recordings: 'r', toots: 't' }

export function sharePath(kind: Kind, handle: string, shareId: string): string {
  return `/u/${handle}/${LINK_SEGMENT[kind]}/${shareId}/`
}

export function tootSongTitle(songId: string | null): string | null {
  return songId === null ? PAD_TOOT_TITLE : (songIndex.find(s => s.id === songId)?.title ?? null)
}

function linkHandle(handle: string, shareId: string): string | null {
  const lower = handle.toLowerCase()
  return HANDLE_SHAPE.test(lower) && SHARE_ID.test(shareId) ? lower : null
}

export async function getHandle(db: Database, user: SessionUser, request: Request) {
  const check = new URL(request.url).searchParams.get('check')
  if (check !== null) {
    const handle = normalizeHandle(check)
    const problem = handleProblem(handle) ?? ((await handleTaken(db, handle)) ? 'taken' : null)
    return Response.json({ handle, problem })
  }
  const handle = await handleOf(db, user.id)
  if (handle !== null) return Response.json({ handle, suggestion: null })
  const email = await emailOf(db, user.id)
  const suggestion = email ? suggestHandle(email) : ''
  const free = suggestion !== '' && !(await handleTaken(db, suggestion))
  return Response.json({ handle: null, suggestion: free ? suggestion : '' })
}

const PICKED_HANDLE = z.object({ handle: z.string() })

export async function putHandle(db: Database, user: SessionUser, request: Request) {
  const body = await readJson(request, PICKED_HANDLE)
  if (body instanceof Response) return body
  const handle = normalizeHandle(body.json.handle)
  const problem = handleProblem(handle)
  if (problem) return Response.json({ error: 'handle_unusable', problem }, { status: 400 })
  const claimed = await claimHandle(db, user.id, handle, new Date())
  if (claimed === 'taken') return apiError(409, 'handle_taken')
  if (claimed === 'hasOne') {
    return Response.json(
      { error: 'has_handle', handle: await handleOf(db, user.id) },
      { status: 409 }
    )
  }
  return Response.json({ handle }, { status: 201 })
}

export async function listShares(db: Database, user: SessionUser, request: Request) {
  const handle = await handleOf(db, user.id)
  const shares = handle === null ? [] : await liveShares(db, user.id)
  const origin = servedOrigin(request)
  return Response.json({
    handle,
    shares: shares.map(share => ({
      kind: share.kind,
      itemId: share.itemId,
      url: `${origin}${sharePath(share.kind, handle as string, share.id)}`
    }))
  })
}

export async function shareItem(
  kind: Kind,
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  const handle = await handleOf(db, user.id)
  if (handle === null) return apiError(409, 'no_handle')
  const status = await itemStatus(db, kind, user.id, id)
  if (status === null) return notFound()
  if (status === 'deleted') return gone()
  const existing = await shareOf(db, user.id, kind, id)
  if (existing?.takenDownAt) return apiError(403, 'taken_down')
  if (kind === 'toots' && (await tootPlaysTakenDown(db, user.id, id))) {
    return apiError(403, 'taken_down')
  }
  const { share, created } = existing
    ? { share: existing, created: false }
    : await addShare(db, {
        id: newShareId(),
        userId: user.id,
        kind,
        itemId: id,
        createdAt: new Date()
      })
  const url = `${servedOrigin(request)}${sharePath(kind, handle, share.id)}`
  return Response.json({ url }, { status: created ? 201 : 200 })
}

export async function unshareItem(
  kind: Kind,
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  await removeShare(db, user.id, kind, id)
  return new Response(null, { status: 204 })
}

type SharedRecording = {
  handle: string
  shareId: string
  recording: Recording
}

export async function findSharedRecording(
  db: Database,
  handle: string,
  shareId: string
): Promise<(SharedRecording & { row: SharedRecordingRow }) | null> {
  const lower = linkHandle(handle, shareId)
  if (lower === null) return null
  const row = await sharedRecording(db, lower, shareId)
  if (!row) return null
  const { audioBytes: _, ...recording } = toRecording(row.recording)
  return { handle: row.handle, shareId, recording: { ...recording, id: shareId }, row }
}

type SharedToot = {
  handle: string
  shareId: string
  title: string
  songId: string | null
  seconds: number
}

export async function findSharedToot(
  db: Database,
  handle: string,
  shareId: string
): Promise<(SharedToot & { row: SharedTootRow }) | null> {
  const lower = linkHandle(handle, shareId)
  if (lower === null) return null
  const row = await sharedToot(db, lower, shareId)
  if (!row) return null
  const { title, songId, seconds } = row.toot
  return { handle: row.handle, shareId, title, songId, seconds, row }
}

export const sharedTootKey = ({ row }: { row: SharedTootRow }) =>
  audioKey(row.share.userId, 'toots', row.toot.id)

export function sharedPart(recording: Recording): Trim {
  const trim = recording.trim
  return trim
    ? { startSeconds: trim.startSeconds, endSeconds: trim.endSeconds }
    : { startSeconds: 0, endSeconds: recording.seconds }
}
