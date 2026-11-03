import { z } from 'zod'

import type { NewRecording, TootFields } from '@/db/library'
import { isPerformance, type Performance } from '@/lib/performance'
import { MAXIMUM_NAME_LENGTH, NO_NOTE, type RecordingTrim } from '@/lib/recordings'

import { apiError, readCapped } from './http'

const ITEM_ID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const SONG_ID = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)

export function isItemId(id: unknown): id is string {
  return ITEM_ID.safeParse(id).success
}

export function isSongId(id: unknown): id is string {
  return SONG_ID.safeParse(id).success
}

const UPLOAD_OVERHEAD_BYTES = 64 * 1024
const JSON_MAX_BYTES = 16 * 1024

const mediaType = (request: Request) =>
  (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()

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

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ json: T } | Response> {
  if (mediaType(request) !== 'application/json') return apiError(415, 'unsupported_media_type')
  const body = await readCapped(request, JSON_MAX_BYTES)
  if (body === null) return apiError(413, 'too_large')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return apiError(400, 'invalid_request')
  }
  const parsed = schema.safeParse(json)
  return parsed.success ? { json: parsed.data } : apiError(400, 'invalid_request')
}

const MAX_SECONDS = 3600
const MAX_ANALYSIS_VERSION = 1000

const finite = z.number()
const between = (min: number, max: number) => z.number().min(min).max(max)
const wholeBetween = (min: number, max: number) => z.number().int().min(min).max(max)
const epochMilliseconds = wholeBetween(946_684_800_000, 4_102_444_800_000)
const seconds = between(0, MAX_SECONDS)

export const TITLE = z.string().trim().min(1).max(200)

const PLACED_PITCH = z.union([z.literal(NO_NOTE), wholeBetween(0, 127)]).nullable()

const NAME = z
  .string()
  .trim()
  .max(MAXIMUM_NAME_LENGTH)
  .transform(name => name || null)
  .nullable()

const PART = z
  .object({ startSeconds: seconds, endSeconds: seconds })
  .refine(part => part.startSeconds < part.endSeconds)

export const TRIM_TOLERANCE_SECONDS = 0.01
const SAMPLE_TOLERANCE = 0.001

const TRIM = z
  .object({ startSeconds: seconds, endSeconds: seconds, fart: PART })
  .refine(
    ({ startSeconds, endSeconds, fart }) =>
      startSeconds < endSeconds &&
      fart.startSeconds >= startSeconds - SAMPLE_TOLERANCE &&
      fart.endSeconds <= endSeconds + SAMPLE_TOLERANCE
  )
  .nullable()

export const PLACEMENT = z
  .object({ placedPitch: PLACED_PITCH.optional(), trim: TRIM.optional(), name: NAME.optional() })
  .refine(placement => Object.keys(placement).length > 0)

const trimFits = (trim: RecordingTrim | null, takeSeconds: number) =>
  trim === null || trim.endSeconds <= takeSeconds + TRIM_TOLERANCE_SECONDS

const ANALYSIS = z
  .discriminatedUnion('state', [
    z.object({ state: z.literal('notAnalyzed') }),
    z.object({
      state: z.literal('analyzed'),
      analysis: z.object({
        gestureStartSeconds: finite,
        gestureEndSeconds: finite,
        cutAtReattack: z.boolean(),
        pitchEstimateMidi: finite.nullable(),
        pitchConfidence: finite,
        recordingPitchMidi: finite.nullable(),
        shortestNoteSeconds: finite.nullable(),
        settleSeconds: seconds.nullable().optional(),
        version: wholeBetween(1, MAX_ANALYSIS_VERSION).optional()
      })
    })
  ])
  .transform(value => (value.state === 'analyzed' ? value.analysis : null))

const RECORDING = z
  .object({
    id: z.string(),
    number: wholeBetween(1, 1_000_000),
    createdAt: epochMilliseconds,
    seconds,
    sampleRate: z.number(),
    waveform: z.array(between(0, 1)).max(256),
    analysis: ANALYSIS,
    placedPitch: PLACED_PITCH.default(null),
    trim: TRIM.default(null),
    name: NAME.default(null)
  })
  .refine(recording => trimFits(recording.trim, recording.seconds))

export function parseRecording(
  value: unknown,
  id: string,
  wavSampleRate: number
): Omit<NewRecording, 'audioBytes'> | null {
  const parsed = RECORDING.safeParse(value)
  if (!parsed.success || parsed.data.id !== id || parsed.data.sampleRate !== wavSampleRate) {
    return null
  }
  return parsed.data
}

const ARRANGEMENT = z.object({
  transposition: between(-48, 48),
  recordingForPitch: z
    .custom<object>(value => typeof value === 'object' && value !== null && !Array.isArray(value))
    .transform(pitches => Object.entries(pitches))
    .pipe(z.array(z.tuple([z.string().regex(/^\d{1,3}$/), ITEM_ID])).max(128))
    .transform(entries => Object.fromEntries(entries.map(([pitch, id]) => [Number(pitch), id])))
})

const PERFORMANCE = z
  .custom<Performance>(isPerformance)
  .transform(({ recordings, taps }) => ({ recordings, taps }))

const NONE = z
  .null()
  .optional()
  .transform(() => null)

const TOOT_FIELDS = { id: z.string(), title: TITLE, createdAt: epochMilliseconds, seconds }

const TOOT = z.union([
  z.object({ ...TOOT_FIELDS, songId: SONG_ID, arrangement: ARRANGEMENT, performance: NONE }),
  z.object({ ...TOOT_FIELDS, songId: z.null(), arrangement: NONE, performance: PERFORMANCE })
])

export function parseToot(value: unknown, id: string): TootFields | null {
  const parsed = TOOT.safeParse(value)
  return parsed.success && parsed.data.id === id ? parsed.data : null
}
