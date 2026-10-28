import { z } from 'zod'

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
import type { Recording } from '@/lib/recordings'
import type { Toot } from '@/lib/toot'

import type { SessionUser } from './auth-session'
import { apiError, gone, notFound } from './http'
import { isItemId, parseRecording, parseToot, readJson, readUpload, TITLE } from './library-input'
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

function toRecording(row: RecordingRow): Recording & { audioBytes: number } {
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
    audioBytes: row.audioBytes
  }
}

function toToot(row: TootRow): Toot & { audioBytes: number } {
  return {
    id: row.id,
    title: row.title,
    songId: row.songId,
    createdAt: row.createdAt.getTime(),
    seconds: row.seconds,
    arrangement: row.arrangement,
    audioBytes: row.audioBytes
  }
}

const LIBRARY_HEADER = 'x-pedos-library'

function wrongLibrary(user: SessionUser, request: Request): Response | null {
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
  if (before.status === 'deleted') return gone()
  const unpaid = paidOnly ? await unpaidTootRefusal(db, user, id) : null
  if (unpaid) return unpaid
  if (before.live >= LIMITS[kind].maxItems) return apiError(409, 'limit_reached')
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

const RENAME = z.object({ title: TITLE })

export async function patchToot(
  { db }: Stores,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  const body = await readJson(request, RENAME)
  if (body instanceof Response) return body
  const { title } = body.json
  const before = await renameToot(db, user.id, id, title)
  if (before === null) return notFound()
  if (before === 'deleted') return gone()
  return Response.json({ id, title })
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
  await deleteUserMedia(media, user.id)
  await deleteUser(db, user.id)
  await deleteUserMedia(media, user.id)
  return new Response(null, { status: 204 })
}
