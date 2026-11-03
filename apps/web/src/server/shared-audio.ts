import type { Kind } from '@/db/library'
import type { Trim } from '@/lib/recordings'
import { wavHeader } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

import { notFound } from './http'
import type { Stores } from './library'
import { audioKey } from './media'
import { findSharedRecording, findSharedToot, sharedPart, sharedTootKey } from './sharing'
import { HEADER_BYTES, readWavHeader, wavHeaderOf } from './wav-header'

export const sharedAudioCacheKey = (request: Request, key: string, part?: Trim) =>
  new Request(
    new URL(
      part
        ? `/__shared-audio/${key}?from=${part.startSeconds}&to=${part.endSeconds}`
        : `/__shared-audio/${key}`,
      request.url
    )
  )

function workersCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches
    ? (caches as unknown as { default: Cache }).default
    : null
}

export function partFrames(
  part: Trim,
  sampleRate: number,
  frames: number
): { start: number; end: number } {
  const start = Math.min(frames - 1, Math.max(0, Math.round(part.startSeconds * sampleRate)))
  const end = Math.min(frames, Math.max(start + 1, Math.round(part.endSeconds * sampleRate)))
  return { start, end }
}

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

type SharedWav = { body: BodyInit; size: number; etag: string }

export async function sharedAudio(
  kind: Kind,
  { db, media }: Stores,
  request: Request,
  handle: string,
  shareId: string
): Promise<Response> {
  if (kind === 'toots') {
    const shared = await findSharedToot(db, handle, shareId)
    if (!shared) return notFound()
    const key = sharedTootKey(shared)
    return cachedAudio(request, sharedAudioCacheKey(request, key), async () => {
      const object = await media.get(key)
      return object && { body: object.body, size: object.size, etag: object.httpEtag }
    })
  }
  const shared = await findSharedRecording(db, handle, shareId)
  if (!shared) return notFound()
  const key = audioKey(shared.row.share.userId, 'recordings', shared.row.recording.id)
  const part = sharedPart(shared.recording)
  return cachedAudio(request, sharedAudioCacheKey(request, key, part), async () => {
    const cut = await cutWav(media, key, part)
    return cut && { body: cut.bytes, size: cut.bytes.byteLength, etag: cut.etag }
  })
}

async function cachedAudio(
  request: Request,
  cacheKey: Request,
  read: () => Promise<SharedWav | null>
): Promise<Response> {
  const cache = workersCache()
  let copy = await cache?.match(cacheKey)
  if (!copy) {
    const wav = await read()
    if (!wav) return notFound()
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

export const SHARED_TOOT_BARS = 60

const LEVEL_FRAMES = 480_000

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
