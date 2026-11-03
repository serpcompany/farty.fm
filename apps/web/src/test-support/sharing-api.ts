import { eq, like } from 'drizzle-orm'
import { expect } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import * as shareRecordingRoute from '@/app/api/share/recordings/[id]/route'
import * as sharesRoute from '@/app/api/share/route'
import * as shareTootRoute from '@/app/api/share/toots/[id]/route'
import * as recordingAudioRoute from '@/app/u/[handle]/r/[id]/audio/route'
import * as recordingReportRoute from '@/app/u/[handle]/r/[id]/report/route'
import * as tootAudioRoute from '@/app/u/[handle]/t/[id]/audio/route'
import * as tootReportRoute from '@/app/u/[handle]/t/[id]/report/route'
import type { Kind } from '@/db/library'
import { markTootPaid, startTootPayment } from '@/db/payments'
import { rateLimit } from '@/db/schema'
import { TOOT_PRICE } from '@/lib/pricing'
import { encodeWav } from '@/lib/wav'

import {
  type As,
  api,
  ORIGIN,
  params,
  R1,
  recordingMetadata,
  request,
  signUp,
  T1,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from './library-api'

export const jsonBody = (body: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const shareRoutes = { recordings: shareRecordingRoute, toots: shareTootRoute }
const linkRoutes = {
  r: { audio: recordingAudioRoute, report: recordingReportRoute },
  t: { audio: tootAudioRoute, report: tootReportRoute }
}

export function linkParts(url: string): { segment: 'r' | 't'; handle: string; id: string } {
  const match = new URL(url).pathname.match(/^\/u\/([^/]+)\/(r|t)\/([^/]+)\/$/)
  if (!match) throw new Error(`Not a share link: ${url}`)
  return { segment: match[2] as 'r' | 't', handle: match[1], id: match[3] }
}

export const share = {
  handle: (as: As) => handleRoute.GET(request('/api/handle/', 'GET', as), params({})),
  check: (handle: string, as: As) =>
    handleRoute.GET(
      request(`/api/handle/?check=${encodeURIComponent(handle)}`, 'GET', as),
      params({})
    ),
  pick: (handle: unknown, as: As) =>
    handleRoute.PUT(request('/api/handle/', 'PUT', as, jsonBody({ handle })), params({})),
  list: (as: As) => sharesRoute.GET(request('/api/share/', 'GET', as), params({})),
  put: (id: string, as: As, kind: Kind = 'recordings') =>
    shareRoutes[kind].PUT(request(`/api/share/${kind}/${id}/`, 'PUT', as), params({ id })),
  stop: (id: string, as: As, kind: Kind = 'recordings') =>
    shareRoutes[kind].DELETE(request(`/api/share/${kind}/${id}/`, 'DELETE', as), params({ id })),
  audio: (url: string, init: RequestInit = {}) => {
    const { segment, handle, id } = linkParts(url)
    return linkRoutes[segment].audio.GET(
      new Request(`${url}audio/`, { ...init, method: 'GET' }),
      params({ handle, id })
    )
  },
  report: (url: string, origin: string | null = ORIGIN, ip: string | null = '203.0.113.1') => {
    const { segment, handle, id } = linkParts(url)
    const headers = new Headers()
    if (ip !== null) headers.set('cf-connecting-ip', ip)
    if (origin !== null) headers.set('origin', origin)
    return linkRoutes[segment].report.POST(
      new Request(`${url}report/`, { method: 'POST', headers }),
      params({ handle, id })
    )
  }
}

export async function withHandle(name: string) {
  const user = await signUp(name)
  expect((await share.pick(name, user)).status).toBe(201)
  return user
}

export async function slots(key: string): Promise<number | null> {
  const [row] = await testDb()
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(eq(rateLimit.key, key))
  return row?.count ?? null
}

export async function slotsLike(pattern: string): Promise<number[]> {
  const rows = await testDb()
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(like(rateLimit.key, pattern))
  return rows.map(row => row.count)
}

export async function uploadRecording(id: string, as: As) {
  const response = await api.put('recordings', id, uploadBody(recordingMetadata(id), wav()), as)
  expect(response.status).toBe(201)
}

export function tootWav(): Uint8Array {
  const samples = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(i / 10))
  return new Uint8Array(encodeWav({ samples, sampleRate: 48_000 }))
}

export const TOOT_RECORDING = '00000000-0000-0000-0000-000000000090'

export const playing = (recordingId: string) => ({
  recordings: [recordingId],
  taps: [
    [0, 0],
    [0.25, 0]
  ]
})

export async function payFor(user: { id: string }, id: string, songId: string | null = 'twinkle') {
  await startTootPayment(testDb(), user.id, id, songId, `cs_test_${id}`, TOOT_PRICE)
  expect(await markTootPaid(testDb(), user.id, id, `cs_test_${id}`)).toBe(true)
}

export async function saveToot(
  id: string,
  user: { id: string; cookie: string },
  audio = tootWav(),
  metadata: { songId: string | null } = tootMetadata(id)
) {
  await payFor(user, id, metadata.songId)
  const response = await api.put('toots', id, uploadBody(metadata, audio), user)
  expect(response.status).toBe(201)
}

export async function shareUrl(id: string, as: As, kind: Kind = 'recordings') {
  const response = await share.put(id, as, kind)
  expect(response.status).toBe(201)
  return ((await response.json()) as { url: string }).url
}

export async function sharer(name: string) {
  const user = await withHandle(name)
  await uploadRecording(R1, user)
  return { ...user, url: await shareUrl(R1, user) }
}

export async function tootSharer(name: string) {
  const user = await withHandle(name)
  await saveToot(T1, user)
  return { ...user, url: await shareUrl(T1, user, 'toots') }
}
