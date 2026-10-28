import { env } from 'cloudflare:test'
import { expect } from 'vitest'

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

export const ORIGIN = 'http://localhost:3116'
export const CF_RAY = '8f3a1c2b4d5e6f70-SJC'

export const R1 = '11111111-1111-4111-8111-111111111111'
export const R2 = '22222222-2222-4222-8222-222222222222'
export const T1 = '33333333-3333-4333-8333-333333333333'

export function routeFailureLine(code: string, name: string, method: string, path: string) {
  return { event: 'route_failed', code, name, method, path, ray: CF_RAY }
}

export const testDb = () => createDatabase(env.DB)
export const media = () => env.MEDIA

export type As = {
  cookie?: string
  origin?: string | null
  library?: string
}

export async function signUp(name: string): Promise<{ id: string; email: string; cookie: string }> {
  const now = new Date()
  const id = `user${name}`
  const email = `${name}@example.test`
  const token = `${name}-${crypto.randomUUID()}`
  await testDb().insert(user).values({ id, name: '', email, createdAt: now, updatedAt: now })
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
  return { id, email, cookie: `${TEST_SESSION_COOKIE}=${token}` }
}

function headers(
  method: string,
  { cookie, origin, library }: As,
  extra: HeadersInit = {}
): Headers {
  const result = new Headers(extra)
  if (cookie) result.set('cookie', cookie)
  if (library) result.set('x-pedos-library', library)
  const sent = origin === undefined ? (method === 'GET' ? null : ORIGIN) : origin
  if (sent !== null) result.set('origin', sent)
  return result
}

const params = <P>(value: P) => ({ params: Promise.resolve(value) })
const noParams = params({} as Record<string, never>)

export function wav(seconds = 0.1, sampleRate = 48_000): Uint8Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  return new Uint8Array(encodeWav({ samples, sampleRate }))
}

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

export const metadataFor = (kind: Kind, id: string, fields: Record<string, unknown> = {}) =>
  kind === 'recordings' ? recordingMetadata(id, fields) : tootMetadata(id, fields)

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

const patchRequest = (kind: Kind, id: string, body: string, as: As) =>
  request(`/api/${kind}/${id}/`, 'PATCH', as, {
    headers: { 'content-type': 'application/json' },
    body
  })

export const api = {
  library: (as: As, since?: number | string) =>
    libraryRoute.GET(
      request(`/api/library/${since === undefined ? '' : `?since=${since}`}`, 'GET', as),
      noParams
    ),

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
    itemRoutes.toots.PATCH(
      patchRequest('toots', id, JSON.stringify({ title }), as),
      params({ id })
    ),

  place: (id: string, placedPitch: unknown, as: As, body = JSON.stringify({ placedPitch })) =>
    itemRoutes.recordings.PATCH(patchRequest('recordings', id, body, as), params({ id })),

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

export function upload(kind: Kind, id: string, cookie: string, audio = wav()) {
  return api.put(kind, id, uploadBody(metadataFor(kind, id), audio), { cookie })
}

export async function audioOf(response: Response) {
  return new Uint8Array(await response.arrayBuffer())
}

type Library = {
  cursor: number
  full: boolean
  recordings: { id: string; number: number; analysis?: unknown }[]
  toots: { id: string; title: string }[]
  deleted: { recordings: string[]; toots: string[] }
}

export async function library(cookie: string, since?: number): Promise<Library> {
  const response = await api.library({ cookie }, since)
  expect(response.status).toBe(200)
  return response.json()
}

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

async function d1Clock(): Promise<number> {
  const row = await env.DB.prepare(
    `select cast(unixepoch('subsec') * 1000 as integer) as now`
  ).first<{ now: number }>()
  return row?.now ?? 0
}

export async function nextD1Millisecond(): Promise<void> {
  const start = await d1Clock()
  while ((await d1Clock()) <= start) {}
}

export async function rowsOf(kind: Kind): Promise<string[]> {
  const { results } = await env.DB.prepare(`select user_id, id from ${kind}`).all<{
    user_id: string
    id: string
  }>()
  return results.map(row => `${row.user_id} ${row.id}`).sort()
}

const ITEM_COLUMNS: Record<Kind, string> = {
  recordings: 'user_id, id, number, created_at, seconds, sample_rate, waveform, analysis',
  toots: 'user_id, id, title, song_id, created_at, seconds, arrangement'
}

const ITEM_VALUES: Record<Kind, string> = {
  recordings: `1, 0, 0.1, 48000, '[]', null`,
  toots: `'Seeded', 'twinkle', 0, 0.1, '{"transposition":0,"recordingForPitch":{}}'`
}

export async function deletedAgo(kind: Kind, userId: string, id: string, age: number) {
  const at = `cast(unixepoch('subsec') * 1000 as integer) - ?3`
  await env.DB.prepare(
    `insert into ${kind} (${ITEM_COLUMNS[kind]}, audio_bytes, updated_at, deleted_at)
     values (?1, ?2, ${ITEM_VALUES[kind]}, 100, ${at}, ${at})`
  )
    .bind(userId, id, age)
    .run()
}

export async function seed(kind: Kind, userId: string, count: number) {
  await env.DB.prepare(
    `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?2)
     insert into ${kind} (${ITEM_COLUMNS[kind]}, audio_bytes, updated_at)
     select ?1, printf('00000000-0000-4000-9000-%012d', i), ${ITEM_VALUES[kind]}, 100, 0 from n`
  )
    .bind(userId, count)
    .run()
}
