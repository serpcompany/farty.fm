import { z } from 'zod'

import { getDb } from '@/db'
import type { Database } from '@/db/database'
import {
  deleteUser,
  favoriteSong,
  forgetDeleted,
  type ItemStatus,
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
  unfavoriteSong,
  uploadState
} from '@/db/library'
import { tootPayment } from '@/db/payments'
import { removeShare } from '@/db/sharing'
import type { Performance } from '@/lib/performance'
import type { Recording, RecordingTrim } from '@/lib/recordings'
import type { Toot, TootArrangement } from '@/lib/toot'

import { type SessionUser, signedInRecently } from './auth-session'
import { uploadsAgainOnceDeleted } from './fixture-recordings'
import { apiError, gone, notFound } from './http'
import {
  isItemId,
  isSongId,
  PLACEMENT,
  parseRecording,
  parseToot,
  readJson,
  readUpload,
  TITLE,
  TRIM_TOLERANCE_SECONDS
} from './library-input'
import { audioKey, deleteUserMedia, getMedia, putAudioOnce } from './media'
import { readWavHeader } from './wav-header'

export type Stores = { db: Database; media: R2Bucket }

export function requestStores(): Stores {
  return { db: getDb(), media: getMedia() }
}

export const LIMITS: Record<Kind, { maxAudioBytes: number; maxItems: number }> = {
  recordings: { maxAudioBytes: 6 * 1024 * 1024, maxItems: 300 },
  toots: { maxAudioBytes: 16 * 1024 * 1024, maxItems: 300 }
}

export const FAVORITE_SONGS_LIMIT = 5000

export function toRecording(row: RecordingRow): Recording & { audioBytes: number } {
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
    trim: trimOfRow(row),
    name: row.name,
    audioBytes: row.audioBytes
  }
}

function trimOfRow(row: RecordingRow): RecordingTrim | null {
  const { trimStartSeconds, trimEndSeconds, trimFartStartSeconds, trimFartEndSeconds } = row
  if (
    trimStartSeconds === null ||
    trimEndSeconds === null ||
    trimFartStartSeconds === null ||
    trimFartEndSeconds === null
  )
    return null
  return {
    startSeconds: trimStartSeconds,
    endSeconds: trimEndSeconds,
    fart: { startSeconds: trimFartStartSeconds, endSeconds: trimFartEndSeconds }
  }
}

function toToot(row: TootRow): Toot & { audioBytes: number } {
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

const LIBRARY_HEADER = 'x-pedos-library'

export function wrongLibrary(user: SessionUser, request: Request): Response | null {
  const library = request.headers.get(LIBRARY_HEADER)
  return library !== null && library !== user.id ? apiError(409, 'wrong_account') : null
}

export function refusedItemRequest(
  user: SessionUser,
  id: string,
  request: Request
): Response | null {
  return isItemId(id) ? wrongLibrary(user, request) : notFound()
}

export async function getLibrary({ db }: Stores, user: SessionUser, request: Request) {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const since = new URL(request.url).searchParams.get('since') ?? '0'
  if (!/^\d{1,15}$/.test(since)) return apiError(400, 'invalid_request')
  let changes = await libraryChanges(db, user.id, Number(since))
  const full = Number(since) < changes.cursor - TOMBSTONE_RETENTION_MS
  if (full && Number(since) > 0) changes = await libraryChanges(db, user.id, 0)
  const live = <T extends { deletedAt: Date | null }>(rows: T[]) => rows.filter(r => !r.deletedAt)
  const deleted = (rows: { id: string; deletedAt: Date | null }[]) =>
    rows.filter(r => r.deletedAt).map(r => r.id)
  return Response.json({
    cursor: changes.cursor,
    full,
    recordings: live(changes.recordings).map(toRecording),
    toots: live(changes.toots).map(toToot),
    favorites: live(changes.favoriteSongs).map(f => f.songId),
    deleted: {
      recordings: deleted(changes.recordings),
      toots: deleted(changes.toots),
      favorites: changes.favoriteSongs.filter(f => f.deletedAt).map(f => f.songId)
    }
  })
}

function refusedFavoriteRequest(
  user: SessionUser,
  songId: string,
  request: Request
): Response | null {
  return isSongId(songId) ? wrongLibrary(user, request) : notFound()
}

export async function putFavorite(
  { db }: Stores,
  user: SessionUser,
  songId: string,
  request: Request
): Promise<Response> {
  const refused = refusedFavoriteRequest(user, songId, request)
  if (refused) return refused
  const marked = await favoriteSong(db, user.id, songId, FAVORITE_SONGS_LIMIT)
  if (marked === 'added') return Response.json({ songId }, { status: 201 })
  if (marked === 'kept') return Response.json({ songId }, { status: 200 })
  return apiError(409, 'limit_reached')
}

export async function deleteFavorite(
  { db }: Stores,
  user: SessionUser,
  songId: string,
  request: Request
): Promise<Response> {
  const refused = refusedFavoriteRequest(user, songId, request)
  if (refused) return refused
  await unfavoriteSong(db, user.id, songId)
  await purgeTombstones(db, user.id)
  return new Response(null, { status: 204 })
}

type AddRow = (audioBytes: number) => Promise<boolean>

type ParsedUpload = { metadata: unknown; wavSampleRate: number; paidOnly: boolean }

function rowAdder(
  kind: Kind,
  db: Database,
  user: SessionUser,
  id: string,
  { metadata, wavSampleRate, paidOnly }: ParsedUpload
): AddRow | null {
  const { maxItems } = LIMITS[kind]
  if (kind === 'recordings') {
    const recording = parseRecording(metadata, id, wavSampleRate)
    return recording
      ? audioBytes => insertRecording(db, user.id, { ...recording, audioBytes }, maxItems)
      : null
  }
  const toot = parseToot(metadata, id)
  const insert = paidOnly ? insertPaidToot : insertToot
  return toot ? audioBytes => insert(db, user.id, { ...toot, audioBytes }, maxItems) : null
}

async function unpaidTootRefusal(
  db: Database,
  user: SessionUser,
  id: string
): Promise<Response | null> {
  const payment = await tootPayment(db, user.id, id)
  if (payment?.savedAt) return gone()
  return payment?.paidAt ? null : apiError(402, 'payment_required')
}

async function addWithAudio(
  kind: Kind,
  { db, media }: Stores,
  user: SessionUser,
  id: string,
  audio: Uint8Array,
  add: AddRow
): Promise<Response> {
  const key = audioKey(user.id, kind, id)
  const stored = await putAudioOnce(media, key, audio)
  let added = false
  try {
    added = await add(stored.size)
  } finally {
    if (!added) {
      const status = await itemStatus(db, kind, user.id, id).catch(() => 'unknown' as const)
      if (status === null || status === 'deleted') await media.delete(key)
    }
  }
  if (added) return Response.json({ id }, { status: 201 })
  const after = await itemStatus(db, kind, user.id, id)
  if (after === 'live') return Response.json({ id }, { status: 200 })
  if (after === 'deleted') return gone()
  return apiError(409, 'limit_reached')
}

export async function putItem(
  kind: Kind,
  stores: Stores,
  user: SessionUser,
  id: string,
  request: Request,
  paidOnly = false
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  const { db } = stores
  const upload = await readUpload(request, LIMITS[kind].maxAudioBytes)
  if (upload instanceof Response) return upload
  const wav = readWavHeader(upload.audio)
  if (!wav) return apiError(400, 'invalid_audio')
  const parsed = { metadata: upload.metadata, wavSampleRate: wav.sampleRate, paidOnly }
  const add = rowAdder(kind, db, user, id, parsed)
  if (!add) return apiError(400, 'invalid_request')

  const before = await uploadState(db, kind, user.id, id)
  if (before.status === 'live') return Response.json({ id }, { status: 200 })
  const again = before.status === 'deleted' && uploadsAgainOnceDeleted(kind, id)
  if (before.status === 'deleted' && !again) return gone()
  const unpaid = paidOnly ? await unpaidTootRefusal(db, user, id) : null
  if (unpaid) return unpaid
  if (before.live >= LIMITS[kind].maxItems) return apiError(409, 'limit_reached')
  if (again) await forgetDeleted(db, kind, user.id, id)
  return addWithAudio(kind, stores, user, id, upload.audio, add)
}

export async function deleteItem(
  kind: Kind,
  { db, media }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  const before = await tombstone(db, kind, user.id, id)
  if (before === null) return notFound()
  await removeShare(db, user.id, kind, id)
  await media.delete(audioKey(user.id, kind, id))
  await purgeTombstones(db, user.id)
  return new Response(null, { status: 204 })
}

export async function getItemAudio(
  kind: Kind,
  { media }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
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

async function patchItem<T extends object>(
  user: SessionUser,
  id: string,
  request: Request,
  schema: z.ZodType<T>,
  update: (fields: T) => Promise<ItemStatus | 'tooLong'>
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  const body = await readJson(request, schema)
  if (body instanceof Response) return body
  const before = await update(body.json)
  if (before === null) return notFound()
  if (before === 'deleted') return gone()
  if (before === 'tooLong') return apiError(400, 'invalid_request')
  return Response.json({ id, ...body.json })
}

const RENAME = z.object({ title: TITLE })

export function patchToot(
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  return patchItem(user, id, request, RENAME, ({ title }) => renameToot(db, user.id, id, title))
}

export function patchRecording(
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  return patchItem(user, id, request, PLACEMENT, placement =>
    placeRecording(db, user.id, id, placement, TRIM_TOLERANCE_SECONDS)
  )
}

const MARKETING_EMAIL = z.object({ marketingEmail: z.boolean() })

export async function patchAccount(
  { db }: Stores,
  user: SessionUser,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request, MARKETING_EMAIL)
  if (body instanceof Response) return body
  const { marketingEmail } = body.json
  if (!(await setMarketingEmail(db, user.id, marketingEmail))) return notFound()
  return Response.json({ marketingEmail })
}

export async function deleteAccount(
  { db, media }: Stores,
  user: SessionUser,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  if (!signedInRecently(user)) return apiError(403, 'sign_in_again')
  await deleteUserMedia(media, user.id)
  await deleteUser(db, user.id)
  await deleteUserMedia(media, user.id)
  return new Response(null, { status: 204 })
}
