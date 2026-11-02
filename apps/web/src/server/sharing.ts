import type { Database } from '@/db/database'
import { itemStatus, type Kind } from '@/db/library'
import {
  addReport,
  addShare,
  claimHandle,
  emailOf,
  handleOf,
  handleTaken,
  liveShares,
  removeShare,
  type SharedRecordingRow,
  sharedRecording,
  shareOf
} from '@/db/sharing'
import { handleProblem, normalizeHandle, suggestHandle } from '@/lib/handle'
import type { Recording } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'

import { consumeSlot, type SlotRule } from './auth-config'
import { type Stores, toRecording, wrongLibrary } from './library'
import { isItemId, readJson } from './library-input'
import { audioKey } from './media'
import { apiError, type SessionUser } from './require-user'

// Sharing (ADR 0020). The owner's routes, under `src/app/api/` with `userRoute`: their Handle, and
// sharing or stopping sharing one of their own Recordings. The public routes, under
// `src/app/u/[handle]/r/[id]/`: the shared page, its audio and its Report, which anyone with the
// link reaches, and which find the Recording only through a live share.

const notFound = () => apiError(404, 'not_found')

/**
 * A link's id: 12 random characters of Crockford's lowercase base 32 (60 bits), so a link can't
 * be guessed from another, and says nothing about the Recording's own id.
 */
const SHARE_ID = /^[0-9a-hjkmnp-tv-z]{12}$/
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, byte => ALPHABET[byte & 31]).join('')
}

/** A shared Recording's page: `/u/<handle>/r/<id>/`. */
export function sharePath(handle: string, shareId: string): string {
  return `/u/${handle}/r/${shareId}/`
}

/**
 * `GET /api/handle/`: the user's Handle, or null and one to suggest, from their email if it's
 * free. `GET /api/handle/?check=<handle>`: whether a Handle can be used, `problem` null if so.
 */
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

/**
 * `PUT /api/handle/` with `{ handle }`: gives the user their Handle, once. 400 with the `problem`
 * when it can't be used, 409 `handle_taken` when someone has it, and 409 `has_handle`, with the
 * user's own, when they already have one.
 */
export async function putHandle(db: Database, user: SessionUser, request: Request) {
  const body = await readJson(request)
  if (body instanceof Response) return body
  const typed = (body.json as { handle?: unknown } | null)?.handle
  if (typeof typed !== 'string') return apiError(400, 'invalid_request')
  const handle = normalizeHandle(typed)
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

/** `GET /api/share/`: the user's shared items that work, each with its link. */
export async function listShares(db: Database, user: SessionUser, request: Request) {
  const handle = await handleOf(db, user.id)
  const shares = handle === null ? [] : await liveShares(db, user.id)
  const origin = servedOrigin(request)
  return Response.json({
    handle,
    shares: shares.map(share => ({
      kind: share.kind,
      itemId: share.itemId,
      url: `${origin}${sharePath(handle as string, share.id)}`
    }))
  })
}

/**
 * `PUT /api/share/{kind}/{id}/`: shares the user's own item, or answers the link it already has.
 * 201 with `{ url }` for a new link, 200 for the same one again. 409 `no_handle` before the user
 * has a Handle, 404 when the item isn't in their account (not uploaded yet, or someone else's),
 * 410 when it's deleted and 403 `taken_down` when Farty took it down after a report.
 */
export async function shareItem(
  kind: Kind,
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const handle = await handleOf(db, user.id)
  if (handle === null) return apiError(409, 'no_handle')
  const status = await itemStatus(db, kind, user.id, id)
  if (status === null) return notFound()
  if (status === 'deleted') return apiError(410, 'deleted')
  const existing = await shareOf(db, user.id, kind, id)
  if (existing?.takenDownAt) return apiError(403, 'taken_down')
  const { share, created } = existing
    ? { share: existing, created: false }
    : await addShare(db, {
        id: newShareId(),
        userId: user.id,
        kind,
        itemId: id,
        createdAt: new Date()
      })
  const url = `${servedOrigin(request)}${sharePath(handle, share.id)}`
  return Response.json({ url }, { status: created ? 201 : 200 })
}

/**
 * `DELETE /api/share/{kind}/{id}/`: stops sharing the user's own item, so its link stops working.
 * 204 whether or not it was shared: the item isn't shared either way. Someone else's item is
 * never theirs to stop.
 */
export async function unshareItem(
  kind: Kind,
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  await removeShare(db, user.id, kind, id)
  return new Response(null, { status: 204 })
}

/** A shared Recording, as its page shows it: no account id, and its link's id for its own. */
export type SharedRecording = {
  handle: string
  shareId: string
  recording: Recording
}

/**
 * The Recording shared at `/u/<handle>/r/<shareId>/`, or null: not shared, stopped, taken down,
 * deleted, or the account deleted all look the same.
 */
export async function findSharedRecording(
  db: Database,
  handle: string,
  shareId: string
): Promise<(SharedRecording & { row: SharedRecordingRow }) | null> {
  // The shape only: a Handle the block list gained since it was picked still finds its links.
  const lower = handle.toLowerCase()
  if (!/^[a-z0-9_]{3,20}$/.test(lower) || !SHARE_ID.test(shareId)) return null
  const row = await sharedRecording(db, lower, shareId)
  if (!row) return null
  const { audioBytes: _, ...recording } = toRecording(row.recording)
  return { handle: row.handle, shareId, recording: { ...recording, id: shareId }, row }
}

/** Where the shared audio's copy is kept in this data center's cache: by its R2 key. */
const cacheKey = (request: Request, key: string) =>
  new Request(new URL(`/__shared-audio/${key}`, request.url))

/** The Workers cache, where there is one (not in `next dev`). */
function workersCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches
    ? (caches as unknown as { default: Cache }).default
    : null
}

/**
 * `GET /u/<handle>/r/<id>/audio/`: the shared Recording's WAV, for anyone with the link. Every
 * request checks the share in D1 first, so a link that stopped working never plays, then the WAV
 * comes from this data center's cache, or from R2 into it. Its key is written once, so the copy is
 * never stale. The browser revalidates every time (`no-cache`, with the ETag), and nothing
 * between keeps it (`private`), so a link taken down is down at once.
 */
export async function sharedAudio(
  { db, media }: Stores,
  request: Request,
  handle: string,
  shareId: string
): Promise<Response> {
  const shared = await findSharedRecording(db, handle, shareId)
  if (!shared) return apiError(404, 'not_found')
  const key = audioKey(shared.row.share.userId, 'recordings', shared.row.recording.id)
  const cache = workersCache()
  let copy = await cache?.match(cacheKey(request, key))
  if (!copy) {
    const object = await media.get(key)
    if (!object) return apiError(404, 'not_found')
    const bytes = await object.arrayBuffer()
    copy = new Response(bytes, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(bytes.byteLength),
        ETag: object.httpEtag,
        'Cache-Control': 'public, max-age=86400'
      }
    })
    await cache?.put(cacheKey(request, key), copy.clone())
  }
  const etag = copy.headers.get('ETag') ?? ''
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
  if (etag && request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(copy.body, {
    headers: {
      ...headers,
      'Content-Type': 'audio/wav',
      'Content-Length': copy.headers.get('Content-Length') ?? ''
    }
  })
}

/**
 * How many reports Farty keeps, each a row in `rate_limit`: a few per link a day, since one is
 * enough for Farty to look, and a cap for the whole site, so a script can't fill D1.
 */
export const REPORT_LIMITS = {
  perShare: { window: 24 * 60 * 60, max: 5 },
  siteWide: { window: 60 * 60, max: 300 }
} satisfies Record<string, SlotRule>

/**
 * `POST /u/<handle>/r/<id>/report/`: anyone's report of a shared Recording, from its page. It keeps
 * a row in `share_reports` naming the share and the item, never the reporter, and logs
 * `share_reported` with the link's id, for Farty to check (docs/agents/web.md). 204 once kept, or
 * when the link already has its day's reports; 403 from another site, 404 when the link doesn't
 * work, 429 when the site has had too many.
 */
export async function reportShare(
  { db }: Stores,
  request: Request,
  handle: string,
  shareId: string
): Promise<Response> {
  if (request.headers.get('origin') !== servedOrigin(request)) {
    return apiError(403, 'cross_origin')
  }
  const shared = await findSharedRecording(db, handle, shareId)
  if (!shared) return apiError(404, 'not_found')
  const now = Date.now()
  // The link's own limit first, so reports of one link past its day's few never spend the site's.
  const perShare = await consumeSlot(
    db.$client,
    `share_report|${shareId}`,
    now,
    REPORT_LIMITS.perShare
  )
  if (!perShare.allowed) return new Response(null, { status: 204 })
  const site = await consumeSlot(db.$client, 'share_report', now, REPORT_LIMITS.siteWide)
  if (!site.allowed) return apiError(429, 'too_many_reports')
  await addReport(db, shared.row.share, crypto.randomUUID(), new Date(now))
  console.warn(JSON.stringify({ event: 'share_reported', shareId, kind: 'recordings' }))
  return new Response(null, { status: 204 })
}
