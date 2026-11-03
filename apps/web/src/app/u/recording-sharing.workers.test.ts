import { describe, expect, it } from 'vitest'

import { encodeWav } from '@/lib/wav'
import { partFrames, sharedAudioCacheKey } from '@/server/shared-audio'
import { findSharedRecording, sharedPart } from '@/server/sharing'
import { readWavHeader } from '@/server/wav-header'
import {
  api,
  ORIGIN,
  R1,
  R2,
  recordingMetadata,
  signUp,
  testDb,
  uploadBody
} from '@/test-support/library-api'
import {
  linkParts,
  share,
  sharer,
  shareUrl,
  uploadRecording,
  withHandle
} from '@/test-support/sharing-api'

const RATE = 8000

const numberedTake = () => {
  const samples = Float32Array.from({ length: RATE }, (_, i) => i / 0x8000)
  return new Uint8Array(encodeWav({ samples, sampleRate: RATE }))
}

const trimmed = (startSeconds: number, endSeconds: number) => ({
  startSeconds,
  endSeconds,
  fart: { startSeconds, endSeconds }
})

async function uploadTake(name: string, fields: Record<string, unknown> = {}) {
  const user = await withHandle(name)
  const metadata = recordingMetadata(R1, { seconds: 1, sampleRate: RATE, ...fields })
  const uploaded = await api.put('recordings', R1, uploadBody(metadata, numberedTake()), user)
  expect(uploaded.status).toBe(201)
  return user
}

async function uploadedSharer(name: string, fields: Record<string, unknown>) {
  const user = await uploadTake(name, fields)
  return { ...user, url: await shareUrl(R1, user) }
}

async function trimmedSharer(trim: ReturnType<typeof trimmed>) {
  const user = await uploadTake('alice')
  expect((await api.placeAndTrim(R1, { placedPitch: 52, trim }, user)).status).toBe(200)
  return { ...user, url: await shareUrl(R1, user) }
}

async function framesOf(response: Response): Promise<number[]> {
  expect(response.status).toBe(200)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const header = readWavHeader(bytes)
  expect(header?.sampleRate).toBe(RATE)
  expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset + 44)
  return Array.from({ length: header?.frames ?? 0 }, (_, i) => view.getInt16(i * 2, true))
}

const range = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, i) => start + i)

describe('Sharing a Recording', () => {
  it('needs a Handle and an uploaded Recording of your own', async () => {
    const alice = await signUp('alice')
    await uploadRecording(R1, alice)
    expect(await (await share.put(R1, alice)).json()).toEqual({ error: 'no_handle' })

    await share.pick('alice', alice)
    expect((await share.put(R2, alice)).status).toBe(404)
    expect((await share.put('not-an-id', alice)).status).toBe(404)
    expect((await share.put(R1, { ...alice, library: 'someone-else' })).status).toBe(409)
    expect((await share.put(R1, {})).status).toBe(401)
  })

  it('shows the page only the Recording, with the link as its id', async () => {
    const alice = await sharer('alice')
    const { handle, id } = linkParts(alice.url)
    const shared = await findSharedRecording(testDb(), handle, id)
    expect(shared).toMatchObject({ handle: 'alice', shareId: id, recording: { id, number: 1 } })
    expect(shared?.recording).not.toHaveProperty('audioBytes')
    expect(await findSharedRecording(testDb(), 'ALICE', id)).not.toBeNull()
    await sharer('bob')
    expect(await findSharedRecording(testDb(), 'bob', id)).toBeNull()
    expect((await share.audio(alice.url.replace('/u/alice/', '/u/bob/'))).status).toBe(404)
  })
})

describe('Sharing a trimmed Recording', () => {
  it('serves only the Trim, never the audio trimmed off', async () => {
    const alice = await trimmedSharer(trimmed(0.25, 0.5))
    expect(await framesOf(await share.audio(alice.url))).toEqual(range(2000, 4000))
  })

  it('serves the new cut once the Trim changes, not the cached one', async () => {
    const alice = await trimmedSharer(trimmed(0.25, 0.5))
    const first = await share.audio(alice.url)
    expect(await framesOf(first)).toEqual(range(2000, 4000))

    expect((await api.placeAndTrim(R1, { trim: trimmed(0.5, 0.625) }, alice)).status).toBe(200)
    const second = await share.audio(alice.url)
    expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'))
    expect(await framesOf(second)).toEqual(range(4000, 5000))

    expect((await api.placeAndTrim(R1, { trim: null }, alice)).status).toBe(200)
    expect(await framesOf(await share.audio(alice.url))).toEqual(range(0, RATE))
  })

  it('serves only a stored Trim, even before analysis or once analysis finds a pitch', async () => {
    const notAnalyzed = await uploadedSharer('alice', {
      analysis: { state: 'notAnalyzed' },
      trim: trimmed(0.25, 0.5)
    })
    expect(await framesOf(await share.audio(notAnalyzed.url))).toEqual(range(2000, 4000))

    const melodic = await uploadedSharer('bob', { trim: trimmed(0.5, 0.625) })
    const { handle, id } = linkParts(melodic.url)
    const shared = await findSharedRecording(testDb(), handle, id)
    if (!shared) throw new Error('Not shared')
    expect(shared.recording.placedPitch ?? null).toBeNull()
    expect(sharedPart(shared.recording)).toEqual({ startSeconds: 0.5, endSeconds: 0.625 })
    expect(await framesOf(await share.audio(melodic.url))).toEqual(range(4000, 5000))
  })

  it('serves the whole take of a Recording with no stored Trim', async () => {
    const alice = await uploadedSharer('alice', { analysis: { state: 'notAnalyzed' } })
    expect(await framesOf(await share.audio(alice.url))).toEqual(range(0, RATE))
  })

  it('serves a Trim of an odd number of frames as a WAV of its own', async () => {
    const alice = await trimmedSharer(trimmed(0.25, 0.250375))
    expect(await framesOf(await share.audio(alice.url))).toEqual(range(2000, 2003))
  })

  it('keys the cached copy by the R2 key and the Trim', () => {
    const request = new Request(`${ORIGIN}/u/alice/r/x/audio/`)
    const key = (from: number, to: number) =>
      sharedAudioCacheKey(request, 'users/a/recordings/r.wav', {
        startSeconds: from,
        endSeconds: to
      }).url
    expect(key(0.25, 0.5)).not.toBe(key(0.25, 0.625))
    expect(key(0.25, 0.5)).not.toBe(key(0.3, 0.5))
    expect(key(0.25, 0.5)).toBe(key(0.25, 0.5))
  })
})

describe('The frames a shared Trim covers', () => {
  const frames = (startSeconds: number, endSeconds: number, sampleRate = 8000, total = 8000) =>
    partFrames({ startSeconds, endSeconds }, sampleRate, total)

  it('starts at the first frame for a Trim at 0', () => {
    expect(frames(0, 0.25)).toEqual({ start: 0, end: 2000 })
    expect(frames(0, 1)).toEqual({ start: 0, end: 8000 })
  })

  it('ends at the last frame for a Trim at the end, or past it by the tolerance', () => {
    expect(frames(0.75, 1)).toEqual({ start: 6000, end: 8000 })
    expect(frames(0.995, 1.01)).toEqual({ start: 7960, end: 8000 })
    expect(frames(1.005, 1.01)).toEqual({ start: 7999, end: 8000 })
  })

  it('rounds each end to its nearest frame, at an odd rate or an odd number of frames', () => {
    expect(frames(0, 0.5, 11025, 11025)).toEqual({ start: 0, end: 5513 })
    expect(frames(0.5, 1, 8000, 8001)).toEqual({ start: 4000, end: 8000 })
    expect(frames(0.5, 2, 8000, 8001)).toEqual({ start: 4000, end: 8001 })
    expect(frames(0.25, 0.250375)).toEqual({ start: 2000, end: 2003 })
  })

  it('covers one frame for an empty or inverted Trim', () => {
    expect(frames(0.5, 0.5)).toEqual({ start: 4000, end: 4001 })
    expect(frames(0.5, 0.25)).toEqual({ start: 4000, end: 4001 })
    expect(frames(1, 1)).toEqual({ start: 7999, end: 8000 })
  })
})
