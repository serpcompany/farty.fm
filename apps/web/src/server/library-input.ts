import type { NewRecording, NewToot } from '@/db/library'
import type { Analysis } from '@/lib/recordings'
import type { TootArrangement } from '@/lib/toot'

import { apiError } from './require-user'

// What the library routes accept, checked by hand: the shapes are small and fixed, and each check
// is a bound on what one user can store. A value that fails any check is refused whole.

/**
 * A Recording's or Toot's id, as the browser gives it (`crypto.randomUUID()`, or the Fixture
 * Library's `00000000-0000-0000-0000-000000000090`). It names an R2 key, so nothing else passes.
 */
export function isItemId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
}

/** Room for the metadata and the multipart boundaries, beside the audio. */
const UPLOAD_OVERHEAD_BYTES = 64 * 1024
/** A JSON body: a title or a switch. */
const JSON_MAX_BYTES = 16 * 1024

/** The body's bytes, or null once it is larger than `maxBytes`, counted as they arrive. */
async function readCapped(
  request: Request,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get('content-length')) > maxBytes) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const mediaType = (request: Request) =>
  (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()

/**
 * An upload: `multipart/form-data` with `metadata`, the Recording or Toot as JSON, and `audio`, its
 * WAV of at most `maxAudioBytes`. Or the response that refuses it.
 */
export async function readUpload(
  request: Request,
  maxAudioBytes: number
): Promise<{ metadata: unknown; audio: Uint8Array } | Response> {
  if (mediaType(request) !== 'multipart/form-data') return apiError(415, 'unsupported_media_type')
  const body = await readCapped(request, maxAudioBytes + UPLOAD_OVERHEAD_BYTES)
  if (body === null) return apiError(413, 'too_large')
  let form: FormData
  try {
    const headers = { 'content-type': request.headers.get('content-type') ?? '' }
    form = await new Response(body, { headers }).formData()
  } catch {
    return apiError(400, 'invalid_request')
  }
  const metadata = form.get('metadata')
  const audio = form.get('audio')
  if (typeof metadata !== 'string' || audio === null || typeof audio === 'string') {
    return apiError(400, 'invalid_request')
  }
  if (audio.size > maxAudioBytes) return apiError(413, 'too_large')
  try {
    return { metadata: JSON.parse(metadata), audio: new Uint8Array(await audio.arrayBuffer()) }
  } catch {
    return apiError(400, 'invalid_request')
  }
}

/** A small `application/json` body, or the response that refuses it. */
export async function readJson(request: Request): Promise<{ json: unknown } | Response> {
  if (mediaType(request) !== 'application/json') return apiError(415, 'unsupported_media_type')
  const body = await readCapped(request, JSON_MAX_BYTES)
  if (body === null) return apiError(413, 'too_large')
  try {
    return { json: JSON.parse(new TextDecoder().decode(body)) }
  } catch {
    return apiError(400, 'invalid_request')
  }
}

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isNumberOrNull = (value: unknown): value is number | null => value === null || isNumber(value)
const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max
const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  isNumber(value) && value >= min && value <= max

/** Epoch milliseconds from 2000 to 2100. */
const isTime = (value: unknown): value is number =>
  isIntegerIn(value, 946_684_800_000, 4_102_444_800_000)
/** Longer than any Song. */
const MAX_SECONDS = 3600
const MAX_WAVEFORM_BARS = 256
const MAX_TITLE_LENGTH = 200
/** Room for the Recording Analysis versions of later releases, which an older Worker still keeps. */
const MAX_ANALYSIS_VERSION = 1000

function parseAnalysis(value: unknown): Analysis | null | undefined {
  if (!isObject(value)) return undefined
  if (value.state === 'notAnalyzed') return null
  const a = value.analysis
  if (value.state !== 'analyzed' || !isObject(a)) return undefined
  const valid =
    isNumber(a.gestureStartSeconds) &&
    isNumber(a.gestureEndSeconds) &&
    typeof a.cutAtReattack === 'boolean' &&
    isNumberOrNull(a.pitchEstimateMidi) &&
    isNumber(a.pitchConfidence) &&
    isNumberOrNull(a.recordingPitchMidi) &&
    isNumberOrNull(a.shortestNoteSeconds) &&
    // A browser on a release before #116 sends none.
    (a.settleSeconds === undefined ||
      a.settleSeconds === null ||
      isNumberIn(a.settleSeconds, 0, MAX_SECONDS)) &&
    // A browser on a release before #208 sends none.
    (a.version === undefined || isIntegerIn(a.version, 1, MAX_ANALYSIS_VERSION))
  if (!valid) return undefined
  return {
    gestureStartSeconds: a.gestureStartSeconds,
    gestureEndSeconds: a.gestureEndSeconds,
    cutAtReattack: a.cutAtReattack,
    pitchEstimateMidi: a.pitchEstimateMidi,
    pitchConfidence: a.pitchConfidence,
    recordingPitchMidi: a.recordingPitchMidi,
    shortestNoteSeconds: a.shortestNoteSeconds,
    ...(a.settleSeconds === undefined ? {} : { settleSeconds: a.settleSeconds }),
    ...(a.version === undefined ? {} : { version: a.version })
  } as Analysis
}

/**
 * The Recording as the browser keeps it (`Recording` in `src/lib/recordings.ts`), once its analysis
 * is done, or null. Its id must be the route's, and its sample rate its WAV's.
 */
export function parseRecording(
  value: unknown,
  id: string,
  wavSampleRate: number
): Omit<NewRecording, 'audioBytes'> | null {
  if (!isObject(value) || value.id !== id) return null
  const { number, createdAt, seconds, sampleRate, waveform } = value
  const analysis = parseAnalysis(value.analysis)
  const valid =
    isIntegerIn(number, 1, 1_000_000) &&
    isTime(createdAt) &&
    isNumberIn(seconds, 0, MAX_SECONDS) &&
    sampleRate === wavSampleRate &&
    Array.isArray(waveform) &&
    waveform.length <= MAX_WAVEFORM_BARS &&
    waveform.every(level => isNumberIn(level, 0, 1)) &&
    analysis !== undefined
  if (!valid) return null
  return { id, number, createdAt, seconds, sampleRate, waveform, analysis }
}

/** A Toot's title: trimmed, and not empty. */
export function parseTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.trim()
  return title.length > 0 && title.length <= MAX_TITLE_LENGTH ? title : null
}

function parseArrangement(value: unknown): TootArrangement | null {
  if (!isObject(value) || !isNumberIn(value.transposition, -48, 48)) return null
  const pitches = value.recordingForPitch
  if (!isObject(pitches)) return null
  const entries = Object.entries(pitches)
  if (entries.length > 128) return null
  const recordingForPitch: Record<number, string> = {}
  for (const [pitch, recordingId] of entries) {
    if (!/^\d{1,3}$/.test(pitch) || !isItemId(recordingId)) return null
    recordingForPitch[Number(pitch)] = recordingId
  }
  return { transposition: value.transposition, recordingForPitch }
}

/** The Toot as the browser keeps it (`Toot` in `src/lib/toot.ts`), or null. */
export function parseToot(value: unknown, id: string): Omit<NewToot, 'audioBytes'> | null {
  if (!isObject(value) || value.id !== id) return null
  const { songId, createdAt, seconds } = value
  const title = parseTitle(value.title)
  const arrangement = parseArrangement(value.arrangement)
  const valid =
    title !== null &&
    typeof songId === 'string' &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(songId) &&
    isTime(createdAt) &&
    isNumberIn(seconds, 0, MAX_SECONDS) &&
    arrangement !== null
  if (!valid) return null
  return { id, title, songId, createdAt, seconds, arrangement }
}
