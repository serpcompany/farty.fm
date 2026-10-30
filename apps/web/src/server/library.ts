import { getDb } from '@/db'
import type { Database } from '@/db/database'
import {
  deleteUser,
  insertPaidToot,
  insertRecording,
  insertToot,
  itemStatus,
  type Kind,
  libraryChanges,
  placeRecording,
  purgeTombstones,
  type RecordingRow,
  renameToot,
  setMarketingEmail,
  TOMBSTONE_RETENTION_MS,
  type TootRow,
  tombstone,
  uploadState
} from '@/db/library'
import { tootPayment } from '@/db/payments'
import type { Performance } from '@/lib/performance'
import type { Recording } from '@/lib/recordings'
import type { Toot, TootArrangement } from '@/lib/toot'

import {
  isItemId,
  parsePlacedPitch,
  parseRecording,
  parseTitle,
  parseToot,
  readJson,
  readUpload
} from './library-input'
import { audioKey, deleteUserMedia, getMedia, putAudioOnce } from './media'
import { apiError, type SessionUser } from './require-user'
import { readWavHeader } from './wav-header'

// What each library route does, given this request's database and bucket. The routes in
// `src/app/api/` build them with `userRoute`, which has already checked the session and, for a
// write, the origin. Every row and key here is the session user's own: someone else's id is
// simply not found.

export type Stores = { db: Database; media: R2Bucket }

/** This request's database and bucket. */
export function requestStores(): Stores {
  return { db: getDb(), media: getMedia() }
}

/** How much one user can keep: the plan's limits (#150). */
export const LIMITS: Record<Kind, { maxAudioBytes: number; maxItems: number }> = {
  /**
   * A Recording is at most `maximumTakeSeconds` (30 s) of mono 16-bit audio at the microphone's
   * own rate: about 2.9 MB at 48 kHz, and 5,760,044 bytes at 96 kHz, which 6 MiB still keeps.
   */
  recordings: { maxAudioBytes: 6 * 1024 * 1024, maxItems: 300 },
  toots: { maxAudioBytes: 16 * 1024 * 1024, maxItems: 300 }
}

/** A Recording, as the browser keeps it, with its audio's size. */
export type LibraryRecording = Recording & { audioBytes: number }
/** A Toot, as the browser keeps it, with its audio's size. */
export type LibraryToot = Toot & { audioBytes: number }

function toRecording(row: RecordingRow): LibraryRecording {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt.getTime(),
    seconds: row.seconds,
    sampleRate: row.sampleRate,
    waveform: row.waveform,
    analysis: row.analysis
      ? { state: 'analyzed', analysis: row.analysis }
      : { state: 'notAnalyzed' },
    placedPitch: row.placedPitch,
    audioBytes: row.audioBytes
  }
}

/**
 * A Toot row as the browser keeps it: of a Song, with its Arrangement, or from the Sound Pad, with
 * its Performance (ADR 0016). The table's check (`toots_song_or_performance`) keeps every row one
 * or the other.
 */
function toToot(row: TootRow): LibraryToot {
  const saved = {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.getTime(),
    seconds: row.seconds,
    audioBytes: row.audioBytes
  }
  if (row.songId === null) {
    return {
      ...saved,
      songId: null,
      arrangement: null,
      performance: row.performance as Performance
    }
  }
  return { ...saved, songId: row.songId, arrangement: row.arrangement as TootArrangement }
}

const notFound = () => apiError(404, 'not_found')
const gone = () => apiError(410, 'deleted')

/**
 * The header each of a browser's library and account requests names its library's account in
 * (`pedos.account`). A library that isn't the session's account's never reads, uploads to,
 * renames or deletes in it, and a page showing one account never deletes or changes another: a
 * sign-in in another tab can change the cookie while this tab's requests are on their way.
 */
export const LIBRARY_HEADER = 'x-pedos-library'

/** 409 `wrong_account` when the request names another account's library, or null. */
export function wrongLibrary(user: SessionUser, request: Request): Response | null {
  const library = request.headers.get(LIBRARY_HEADER)
  return library !== null && library !== user.id ? apiError(409, 'wrong_account') : null
}

/**
 * `GET /api/library/?since=`: what changed since the `cursor` an earlier answer gave (everything
 * without `since`), with the ids of Recordings and Toots deleted since. `full` says the answer
 * lists every live Recording and Toot: `since` is older than the tombstones are kept, so a browser
 * drops what it holds from the account that isn't listed. 409 when `LIBRARY_HEADER` names another
 * account (`wrong_account`), as for every library route.
 */
export async function getLibrary({ db }: Stores, user: SessionUser, request: Request) {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const since = new URL(request.url).searchParams.get('since') ?? '0'
  if (!/^\d{1,15}$/.test(since)) return apiError(400, 'invalid_request')
  const changes = await libraryChanges(db, user.id, Number(since))
  const live = <T extends { deletedAt: Date | null }>(rows: T[]) => rows.filter(r => !r.deletedAt)
  const deleted = (rows: { id: string; deletedAt: Date | null }[]) =>
    rows.filter(r => r.deletedAt).map(r => r.id)
  return Response.json({
    cursor: changes.cursor,
    full: Number(since) < changes.cursor - TOMBSTONE_RETENTION_MS,
    recordings: live(changes.recordings).map(toRecording),
    toots: live(changes.toots).map(toToot),
    deleted: { recordings: deleted(changes.recordings), toots: deleted(changes.toots) }
  })
}

/**
 * `PUT /api/{recordings|toots}/{id}/`: keeps a new Recording or Toot and its WAV. 201 once kept,
 * 200 if it already was (an upload that's retried changes nothing), 410 if it was deleted, 409 at
 * the limit, or when `LIBRARY_HEADER` names another account (`wrong_account`). With `paidOnly`,
 * where saving a Toot is paid (ADR 0010), 402 for a new one that isn't paid for
 * (`payment_required`), and the first save uses its payment up: 410 for one saved and deleted
 * since, even once its tombstone is purged.
 */
export async function putItem(
  kind: Kind,
  { db, media }: Stores,
  user: SessionUser,
  id: string,
  request: Request,
  paidOnly = false
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const { maxAudioBytes, maxItems } = LIMITS[kind]
  const upload = await readUpload(request, maxAudioBytes)
  if (upload instanceof Response) return upload
  const wav = readWavHeader(upload.audio)
  if (!wav) return apiError(400, 'invalid_audio')
  let add: ((audioBytes: number) => Promise<boolean>) | null = null
  if (kind === 'recordings') {
    const recording = parseRecording(upload.metadata, id, wav.sampleRate)
    if (recording) {
      add = audioBytes => insertRecording(db, user.id, { ...recording, audioBytes }, maxItems)
    }
  } else {
    const toot = parseToot(upload.metadata, id)
    const insert = paidOnly ? insertPaidToot : insertToot
    if (toot) add = audioBytes => insert(db, user.id, { ...toot, audioBytes }, maxItems)
  }
  if (!add) return apiError(400, 'invalid_request')

  const before = await uploadState(db, kind, user.id, id)
  if (before.status === 'live') return Response.json({ id }, { status: 200 })
  if (before.status === 'deleted') return gone()
  if (paidOnly) {
    const payment = await tootPayment(db, user.id, id)
    if (payment?.savedAt) return gone()
    if (!payment?.paidAt) return apiError(402, 'payment_required')
  }
  if (before.live >= maxItems) return apiError(409, 'limit_reached')

  const key = audioKey(user.id, kind, id)
  const stored = await putAudioOnce(media, key, upload.audio)
  let added = false
  try {
    added = await add(stored.size)
  } finally {
    // The row wasn't added: an error, the limit reached by another upload at the same time, or
    // another upload of this id kept or deleted it meanwhile. Unless that one is live, nothing
    // plays this audio, so it mustn't stay behind.
    if (!added) {
      const status = await itemStatus(db, kind, user.id, id).catch(() => 'unknown' as const)
      if (status === null || status === 'deleted') await media.delete(key)
    }
  }
  if (added) return Response.json({ id }, { status: 201 })
  // Another upload of the same id won the race: it is kept, or deleted already.
  const after = await itemStatus(db, kind, user.id, id)
  if (after === 'live') return Response.json({ id }, { status: 200 })
  if (after === 'deleted') return gone()
  return apiError(409, 'limit_reached')
}

/**
 * `DELETE /api/{recordings|toots}/{id}/`: leaves a tombstone, so other browsers delete it too, then
 * deletes the WAV. Deleting a tombstone again deletes the WAV again, so a retry finishes the job.
 * Each delete also purges the user's tombstones older than `TOMBSTONE_RETENTION_MS`, so they
 * number at most the deletes of that long.
 */
export async function deleteItem(
  kind: Kind,
  { db, media }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const before = await tombstone(db, kind, user.id, id)
  if (before === null) return notFound()
  await media.delete(audioKey(user.id, kind, id))
  await purgeTombstones(db, user.id)
  return new Response(null, { status: 204 })
}

/** `GET /api/{recordings|toots}/{id}/audio/`: the WAV, from under the session user's own prefix. */
export async function getItemAudio(
  kind: Kind,
  { media }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const object = await media.get(audioKey(user.id, kind, id))
  if (!object) return notFound()
  return new Response(object.body, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(object.size),
      ETag: object.httpEtag
    }
  })
}

/** `PATCH /api/toots/{id}/` with `{ title }`: renames a Toot. The last rename to arrive wins. */
export async function patchToot(
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request)
  if (body instanceof Response) return body
  const title = parseTitle((body.json as { title?: unknown } | null)?.title)
  if (title === null) return apiError(400, 'invalid_request')
  const before = await renameToot(db, user.id, id, title)
  if (before === null) return notFound()
  if (before === 'deleted') return gone()
  return Response.json({ id, title })
}

/**
 * `PATCH /api/recordings/{id}/` with `{ placedPitch }`: places a Noise-like Recording on a note by
 * ear, or takes it off with null (ADR 0015). The last to arrive wins. The analysis stays the
 * upload's: each browser re-analyzes its own.
 */
export async function patchRecording(
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request)
  if (body instanceof Response) return body
  const placedPitch = parsePlacedPitch((body.json as { placedPitch?: unknown } | null)?.placedPitch)
  if (placedPitch === undefined) return apiError(400, 'invalid_request')
  const before = await placeRecording(db, user.id, id, placedPitch)
  if (before === null) return notFound()
  if (before === 'deleted') return gone()
  return Response.json({ id, placedPitch })
}

/**
 * `PATCH /api/account/` with `{ marketingEmail }`: turns Farty news by email on or off. 409 when
 * `LIBRARY_HEADER` names another account (`wrong_account`).
 */
export async function patchAccount(
  { db }: Stores,
  user: SessionUser,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request)
  if (body instanceof Response) return body
  const marketingEmail = (body.json as { marketingEmail?: unknown } | null)?.marketingEmail
  if (typeof marketingEmail !== 'boolean') return apiError(400, 'invalid_request')
  if (!(await setMarketingEmail(db, user.id, marketingEmail))) return notFound()
  return Response.json({ marketingEmail })
}

/**
 * `DELETE /api/account/`: deletes all the user's audio, then their row, which deletes their
 * sessions, Recordings and Toots with it. Audio first, so a failure leaves an account to retry
 * with, never audio with no account. Then the audio again: an upload already past its session
 * check may have written a WAV between the two, and its row can no longer be added. 409, deleting
 * nothing, when `LIBRARY_HEADER` names another account (`wrong_account`).
 */
export async function deleteAccount(
  { db, media }: Stores,
  user: SessionUser,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  await deleteUserMedia(media, user.id)
  await deleteUser(db, user.id)
  await deleteUserMedia(media, user.id)
  return new Response(null, { status: 204 })
}
