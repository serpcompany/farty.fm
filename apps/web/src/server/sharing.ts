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
  type SharedTootRow,
  type ShareRow,
  sharedRecording,
  sharedToot,
  shareOf,
  tootPlaysTakenDown
} from '@/db/sharing'
import { handleProblem, normalizeHandle, suggestHandle } from '@/lib/handle'
import type { Recording, Trim } from '@/lib/recordings'
import { servedOrigin } from '@/lib/site'
import { wavHeader } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

import { consumeSlots, reporterLimitKey, requestClient, type SlotRule } from './auth-config'
import { type Stores, toRecording, wrongLibrary } from './library'
import { isItemId, readJson } from './library-input'
import { audioKey } from './media'
import { apiError, type SessionUser } from './require-user'
import { HEADER_BYTES, readWavHeader, wavHeaderOf } from './wav-header'

// Sharing (ADR 0020). The owner's routes, under `src/app/api/` with `userRoute`: their Handle, and
// sharing or stopping sharing one of their own Recordings or saved Toots. The public routes, under
// `src/app/u/[handle]/r/[id]/` for a Recording and `src/app/u/[handle]/t/[id]/` for a Toot: the
// shared page, its audio and its Report, which anyone with the link reaches, and which find the
// item only through a live share.

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

/** Each kind's links: `r` for a Recording, `t` for a Toot. */
const LINK_SEGMENT: Record<Kind, string> = { recordings: 'r', toots: 't' }

/** A shared item's page: `/u/<handle>/r/<id>/` for a Recording, or `/u/<handle>/t/<id>/`. */
export function sharePath(kind: Kind, handle: string, shareId: string): string {
  return `/u/${handle}/${LINK_SEGMENT[kind]}/${shareId}/`
}

/**
 * The Handle a link names, lowercased, when the link has the shape of one, or else null. The shape
 * only: a Handle the block list gained since it was picked still finds its links.
 */
function linkHandle(handle: string, shareId: string): string | null {
  const lower = handle.toLowerCase()
  return /^[a-z0-9_]{3,20}$/.test(lower) && SHARE_ID.test(shareId) ? lower : null
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
      url: `${origin}${sharePath(share.kind, handle as string, share.id)}`
    }))
  })
}

/**
 * `PUT /api/share/{kind}/{id}/`: shares the user's own item, or answers the link it already has.
 * 201 with `{ url }` for a new link, 200 for the same one again. 409 `no_handle` before the user
 * has a Handle, 404 when the item isn't in their account (not uploaded yet, or someone else's),
 * 410 when it's deleted and 403 `taken_down` when Farty took it down after a report, or, for a
 * Toot, took down a Recording it plays.
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
  const lower = linkHandle(handle, shareId)
  if (lower === null) return null
  const row = await sharedRecording(db, lower, shareId)
  if (!row) return null
  const { audioBytes: _, ...recording } = toRecording(row.recording)
  return { handle: row.handle, shareId, recording: { ...recording, id: shareId }, row }
}

/** A shared Toot, as its page shows it: its title, Song and length, and nothing private. */
export type SharedToot = {
  handle: string
  shareId: string
  title: string
  /** The catalog Song it plays, or null for a Sound Pad Toot (ADR 0017). */
  songId: string | null
  seconds: number
}

/**
 * The saved Toot shared at `/u/<handle>/t/<shareId>/`, or null, as `findSharedRecording`: not
 * shared, stopped, taken down, never saved, deleted, or the account deleted all look the same.
 */
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

/** A shared Toot's audio in R2: its saved WAV. */
export const sharedTootKey = ({ row }: { row: SharedTootRow }) =>
  audioKey(row.share.userId, 'toots', row.toot.id)

/**
 * The part of a shared Recording its link serves, and its page draws: the handles of its stored
 * Trim, whenever it has one, or else the whole take. Unlike `playedPart`, a stored Trim counts
 * whatever analysis found, so a Re-scan that finds a pitch never makes the audio its owner cut
 * off public.
 */
export function sharedPart(recording: Recording): Trim {
  const trim = recording.trim
  return trim
    ? { startSeconds: trim.startSeconds, endSeconds: trim.endSeconds }
    : { startSeconds: 0, endSeconds: recording.seconds }
}

/**
 * Where the shared audio's copy is kept in this data center's cache: by its R2 key, which is
 * written once, and for a Recording the part of it served, so a changed Trim never serves the old
 * cut. A Toot's is its whole WAV.
 */
export const sharedAudioCacheKey = (request: Request, key: string, part?: Trim) =>
  new Request(
    new URL(
      part
        ? `/__shared-audio/${key}?from=${part.startSeconds}&to=${part.endSeconds}`
        : `/__shared-audio/${key}`,
      request.url
    )
  )

/** The Workers cache, where there is one (not in `next dev`). */
function workersCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches
    ? (caches as unknown as { default: Cache }).default
    : null
}

/**
 * The frames `[start, end)` of a take of `frames` at `sampleRate` that `part` covers, each end at
 * its nearest frame: at least one.
 */
export function partFrames(
  part: Trim,
  sampleRate: number,
  frames: number
): { start: number; end: number } {
  const start = Math.min(frames - 1, Math.max(0, Math.round(part.startSeconds * sampleRate)))
  const end = Math.min(frames, Math.max(start + 1, Math.round(part.endSeconds * sampleRate)))
  return { start, end }
}

/**
 * The part of the WAV at `key` that `part` covers, as a WAV of its own: a plain cut of its frames,
 * read from R2 as a range, under a fresh header. Nothing outside `part` is read. Null when the
 * object is gone or isn't a WAV as Farty writes one.
 */
async function cutWav(
  media: R2Bucket,
  key: string,
  part: Trim
): Promise<{ bytes: Uint8Array<ArrayBuffer>; etag: string } | null> {
  const head = await media.get(key, { range: { offset: 0, length: HEADER_BYTES } })
  if (!head) return null
  const header = wavHeaderOf(new Uint8Array(await head.arrayBuffer()), head.size)
  if (!header) return null
  const { start, end } = partFrames(part, header.sampleRate, header.frames)
  const length = (end - start) * 2
  const body = await media.get(key, { range: { offset: HEADER_BYTES + start * 2, length } })
  if (!body) return null
  const bytes = new Uint8Array(HEADER_BYTES + length)
  bytes.set(wavHeader(header.sampleRate, length))
  bytes.set(new Uint8Array(await body.arrayBuffer()), HEADER_BYTES)
  return { bytes, etag: `"${body.etag}-${start}-${end}"` }
}

/** Shared audio, as it's served: a WAV's bytes or stream, its size and its ETag. */
type SharedWav = { body: BodyInit; size: number; etag: string }

/**
 * `GET /u/<handle>/r/<id>/audio/` and `GET /u/<handle>/t/<id>/audio/`: a shared item's audio, for
 * anyone with the link. A Recording's is the part its page plays (`sharedPart`) as a WAV of its
 * own, and the rest of the take is never served. A Toot's is its saved WAV, whole and as stored.
 * Every request checks the share in D1 first, so a link that stopped working never plays, then the
 * WAV comes from this data center's cache, or from R2 into it. The browser revalidates every time
 * (`no-cache`, with the ETag), and nothing between keeps it (`private`), so a link taken down is
 * down at once.
 */
export async function sharedAudio(
  kind: Kind,
  { db, media }: Stores,
  request: Request,
  handle: string,
  shareId: string
): Promise<Response> {
  if (kind === 'toots') {
    const shared = await findSharedToot(db, handle, shareId)
    if (!shared) return apiError(404, 'not_found')
    const key = sharedTootKey(shared)
    return cachedAudio(request, sharedAudioCacheKey(request, key), async () => {
      const object = await media.get(key)
      return object && { body: object.body, size: object.size, etag: object.httpEtag }
    })
  }
  const shared = await findSharedRecording(db, handle, shareId)
  if (!shared) return apiError(404, 'not_found')
  const key = audioKey(shared.row.share.userId, 'recordings', shared.row.recording.id)
  const part = sharedPart(shared.recording)
  return cachedAudio(request, sharedAudioCacheKey(request, key, part), async () => {
    const cut = await cutWav(media, key, part)
    return cut && { body: cut.bytes, size: cut.bytes.byteLength, etag: cut.etag }
  })
}

/**
 * The WAV kept at `cacheKey` in this data center's cache, or else `read`'s, kept there for next
 * time, answered as `sharedAudio` says: `private, no-cache` with its ETag, and 304 when the browser
 * has it. 404 when `read` finds nothing.
 */
async function cachedAudio(
  request: Request,
  cacheKey: Request,
  read: () => Promise<SharedWav | null>
): Promise<Response> {
  const cache = workersCache()
  let copy = await cache?.match(cacheKey)
  if (!copy) {
    const wav = await read()
    if (!wav) return apiError(404, 'not_found')
    copy = new Response(wav.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.size),
        ETag: wav.etag,
        'Cache-Control': 'public, max-age=86400'
      }
    })
    await cache?.put(cacheKey, copy.clone())
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

/** How many loudness bars a shared Toot's page and link image draw. */
export const SHARED_TOOT_BARS = 60

/** At most about this many frames are read for a Toot's bars; a longer one is read every few. */
const LEVEL_FRAMES = 480_000

/**
 * The loudness bars of a shared Toot's saved WAV at `key` (`sharedTootKey`), each 0…1, for its
 * page and link image: from this data center's cache, or read from R2 into it, since the WAV at a
 * key never changes. Flat when the audio is gone. Call it only for a share found in D1
 * (`findSharedToot`). A Toot longer than `LEVEL_FRAMES` is read every few frames, which draws the
 * same bars for a fraction of the work. `origin` is the site's, which the cache keys it under.
 */
export async function sharedTootLevels(
  media: R2Bucket,
  key: string,
  origin: string
): Promise<number[]> {
  const flat = Array<number>(SHARED_TOOT_BARS).fill(0.05)
  const cache = workersCache()
  const cacheKey = new Request(new URL(`/__shared-levels/${key}?bars=${SHARED_TOOT_BARS}`, origin))
  const kept = await cache?.match(cacheKey)
  if (kept) return (await kept.json()) as number[]
  const object = await media.get(key)
  if (!object) return flat
  const bytes = new Uint8Array(await object.arrayBuffer())
  const header = readWavHeader(bytes)
  if (!header) return flat
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset + HEADER_BYTES, header.frames)
  const step = Math.max(1, Math.floor(header.frames / LEVEL_FRAMES))
  const levels = waveformLevels(samples, SHARED_TOOT_BARS, step)
  await cache?.put(
    cacheKey,
    Response.json(levels, { headers: { 'Cache-Control': 'public, max-age=86400' } })
  )
  return levels
}

/**
 * How many reports Farty keeps, each a row in `rate_limit` (`consumeSlots`), for Recordings and
 * Toots alike: a few per reporter an hour, so one client can't spend the site's; a few per item a
 * day, since one is enough for Farty to look, and sharing it again under a new link doesn't start
 * them over; and a cap for the whole site, so a script can't fill D1. A report spends a slot of
 * each only when all three have one, so a refused report never spends a link's.
 */
export const REPORT_LIMITS = {
  perReporter: { window: 60 * 60, max: 10 },
  perItem: { window: 24 * 60 * 60, max: 5 },
  siteWide: { window: 60 * 60, max: 300 }
} satisfies Record<string, SlotRule>

/** The site's one row for Reports. */
export const SITE_REPORTS_KEY = 'share_report'

/** A shared item's row for Reports, whichever link it's shared under: its owner's and own id. */
export const itemReportsKey = (share: { userId: string; kind: Kind; itemId: string }) =>
  `share_report_item|${share.userId}|${share.kind}|${share.itemId}`

/**
 * `POST /u/<handle>/r/<id>/report/` and `POST /u/<handle>/t/<id>/report/`: anyone's report of a
 * shared Recording or Toot, from its page. It keeps a row in `share_reports` naming the share and
 * the item, never the reporter, and logs `share_reported` with the link's id and kind, for Farty
 * to check (docs/agents/web.md). 204 once kept; 403
 * from another site, 404 when the link doesn't work, 429 `too_many_reports` past any of
 * `REPORT_LIMITS`. The reporter's limit is keyed by an HMAC of their `cf-connecting-ip` under
 * `secret`, never the address.
 */
export async function reportShare(
  kind: Kind,
  { db }: Stores,
  request: Request,
  handle: string,
  shareId: string,
  secret: string
): Promise<Response> {
  if (request.headers.get('origin') !== servedOrigin(request)) {
    return apiError(403, 'cross_origin')
  }
  const share = await liveShare(kind, db, handle, shareId)
  if (!share) return apiError(404, 'not_found')
  const now = Date.now()
  const allowed = await consumeSlots(
    db.$client,
    [
      {
        key: await reporterLimitKey(secret, requestClient(request)),
        rule: REPORT_LIMITS.perReporter
      },
      { key: itemReportsKey(share), rule: REPORT_LIMITS.perItem },
      { key: SITE_REPORTS_KEY, rule: REPORT_LIMITS.siteWide }
    ],
    now
  )
  if (!allowed) return apiError(429, 'too_many_reports')
  await addReport(db, share, crypto.randomUUID(), new Date(now))
  console.warn(JSON.stringify({ event: 'share_reported', shareId, kind }))
  return new Response(null, { status: 204 })
}

/** The live share of a `kind` item at a link, while its item is live too, or null. */
async function liveShare(
  kind: Kind,
  db: Database,
  handle: string,
  shareId: string
): Promise<ShareRow | null> {
  const shared =
    kind === 'toots'
      ? await findSharedToot(db, handle, shareId)
      : await findSharedRecording(db, handle, shareId)
  return shared?.row.share ?? null
}
