import { env } from 'cloudflare:test'

import * as accountRoute from '@/app/api/account/route'
import * as libraryRoute from '@/app/api/library/route'
import * as recordingAudioRoute from '@/app/api/recordings/[id]/audio/route'
import * as recordingRoute from '@/app/api/recordings/[id]/route'
import * as tootAudioRoute from '@/app/api/toots/[id]/audio/route'
import * as tootRoute from '@/app/api/toots/[id]/route'
import { createDatabase } from '@/db/database'
import type { Kind } from '@/db/library'
import { session, user } from '@/db/schema'
import { encodeWav } from '@/lib/wav'

import { TEST_SESSION_COOKIE } from './workers-session'

// The library API as a browser calls it, for the `workers` tests: requests to the route handlers
// themselves, with a session cookie and this site's Origin unless a test says otherwise.

/** Where the test requests go. A local run's own origin is its request's (`servedOrigin`). */
export const ORIGIN = 'http://localhost:3116'

export const testDb = () => createDatabase(env.DB)
export const media = () => env.MEDIA

/** Who sends a request: their session cookie (none when signed out), and the page's origin. */
export type As = {
  cookie?: string
  origin?: string | null
  /** The library's account the request names (`x-pedos-library`), as the browser sends it. */
  library?: string
}

/** A user with an account and a signed-in browser. */
export async function signUp(name: string): Promise<{ id: string; cookie: string }> {
  const now = new Date()
  const id = `user${name}`
  const token = `${name}-${crypto.randomUUID()}`
  await testDb()
    .insert(user)
    .values({ id, name: '', email: `${name}@example.test`, createdAt: now, updatedAt: now })
  await testDb()
    .insert(session)
    .values({
      id: `session${name}`,
      userId: id,
      token,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now
    })
  return { id, cookie: `${TEST_SESSION_COOKIE}=${token}` }
}

function headers(
  method: string,
  { cookie, origin, library }: As,
  extra: HeadersInit = {}
): Headers {
  const result = new Headers(extra)
  if (cookie) result.set('cookie', cookie)
  if (library) result.set('x-pedos-library', library)
  // Browsers send Origin with every write, and pages can't change it.
  const sent = origin === undefined ? (method === 'GET' ? null : ORIGIN) : origin
  if (sent !== null) result.set('origin', sent)
  return result
}

const params = <P>(value: P) => ({ params: Promise.resolve(value) })
const noParams = params({} as Record<string, never>)

/** A WAV as the app writes it: silence, mono 16-bit. */
export function wav(seconds = 0.1, sampleRate = 48_000): Uint8Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  return new Uint8Array(encodeWav({ samples, sampleRate }))
}

/** A Recording as the browser keeps it once analyzed. */
export function recordingMetadata(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    number: 1,
    createdAt: Date.UTC(2026, 9, 21),
    seconds: 0.1,
    sampleRate: 48_000,
    waveform: [0, 0.5, 1],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: 0.01,
        gestureEndSeconds: 0.09,
        cutAtReattack: false,
        pitchEstimateMidi: 52,
        pitchConfidence: 0.8,
        recordingPitchMidi: 52.3,
        shortestNoteSeconds: 0.05
      }
    },
    ...fields
  }
}

/** A Toot as the browser keeps it. */
export function tootMetadata(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Twinkle Twinkle Little Star',
    songId: 'twinkle',
    createdAt: Date.UTC(2026, 9, 21),
    seconds: 0.1,
    arrangement: {
      transposition: -12,
      recordingForPitch: { 60: '00000000-0000-0000-0000-000000000090' }
    },
    ...fields
  }
}

/** A Sound Pad Toot as the browser keeps it (ADR 0016): no Song, and its Performance. */
export function padTootMetadata(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    title: 'Sound Pad',
    songId: null,
    createdAt: Date.UTC(2026, 9, 30),
    seconds: 0.1,
    arrangement: null,
    performance: {
      recordings: ['00000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000084'],
      taps: [
        [0, 0],
        [0.25, 1],
        [0.5, 0]
      ]
    },
    ...fields
  }
}

/** The body a browser uploads: the item's JSON and its WAV. */
export function uploadBody(metadata: unknown, audio: Uint8Array): FormData {
  const form = new FormData()
  form.set('metadata', JSON.stringify(metadata))
  form.set('audio', new Blob([audio as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'a.wav')
  return form
}

const itemRoutes = { recordings: recordingRoute, toots: tootRoute }
const audioRoutes = { recordings: recordingAudioRoute, toots: tootAudioRoute }

function request(path: string, method: string, as: As, init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    method,
    headers: headers(method, as, init.headers)
  })
}

export const api = {
  library: (as: As, since?: number | string) =>
    libraryRoute.GET(
      request(`/api/library/${since === undefined ? '' : `?since=${since}`}`, 'GET', as),
      noParams
    ),

  /** Uploads a Recording or Toot. `body` is the multipart form, unless a test sends another. */
  put: (kind: Kind, id: string, body: BodyInit, as: As, init: RequestInit = {}) =>
    itemRoutes[kind].PUT(
      request(`/api/${kind}/${id}/`, 'PUT', as, { ...init, body }),
      params({ id })
    ),

  delete: (kind: Kind, id: string, as: As) =>
    itemRoutes[kind].DELETE(request(`/api/${kind}/${id}/`, 'DELETE', as), params({ id })),

  audio: (kind: Kind, id: string, as: As) =>
    audioRoutes[kind].GET(request(`/api/${kind}/${id}/audio/`, 'GET', as), params({ id })),

  rename: (id: string, title: unknown, as: As) =>
    tootRoute.PATCH(
      request(`/api/toots/${id}/`, 'PATCH', as, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title })
      }),
      params({ id })
    ),

  /** Places a Recording on a note, or takes it off with null (`body` overrides the JSON sent). */
  place: (id: string, placedPitch: unknown, as: As, body?: string) =>
    recordingRoute.PATCH(
      request(`/api/recordings/${id}/`, 'PATCH', as, {
        headers: { 'content-type': 'application/json' },
        body: body ?? JSON.stringify({ placedPitch })
      }),
      params({ id })
    ),

  patchAccount: (body: unknown, as: As) =>
    accountRoute.PATCH(
      request('/api/account/', 'PATCH', as, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      noParams
    ),

  deleteAccount: (as: As) => accountRoute.DELETE(request('/api/account/', 'DELETE', as), noParams)
}

/** Every key in the bucket, sorted. */
export async function bucketKeys(prefix = ''): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await media().list({ prefix, cursor })
    keys.push(...page.objects.map(object => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys.sort()
}
