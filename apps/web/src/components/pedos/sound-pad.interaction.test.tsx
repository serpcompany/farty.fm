import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'

// The Sound Pad in a DOM: a press on a Pad whose sound isn't ready is dropped, never played later,
// and audio this browser can't get yet isn't reported, while a sound that won't decode is.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => ({
  loadPadSound: vi.fn(),
  playPadSound: vi.fn(),
  reportError: vi.fn()
}))

const recording: Recording = {
  id: 'a',
  number: 1,
  createdAt: 0,
  seconds: 1,
  sampleRate: 48000,
  waveform: [],
  analysis: {
    state: 'analyzed',
    analysis: {
      gestureStartSeconds: 0,
      gestureEndSeconds: 0.9,
      cutAtReattack: false,
      pitchEstimateMidi: null,
      pitchConfidence: 0,
      recordingPitchMidi: null,
      shortestNoteSeconds: null
    }
  }
}

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    recordings: [recording],
    recording: (id: string) => (id === recording.id ? recording : undefined)
  })
}))
vi.mock('@/lib/audio/pad-player', async importOriginal => ({
  PadAudioUnavailable: (await importOriginal<typeof import('@/lib/audio/pad-player')>())
    .PadAudioUnavailable,
  loadPadSound: page.loadPadSound,
  playPadSound: page.playPadSound,
  keepPadSounds: () => undefined,
  stopPadSounds: () => undefined
}))
vi.mock('@/lib/audio/context', () => ({ startAudioInTap: () => undefined }))
vi.mock('@/lib/pad-store', () => ({ loadPads: async () => new Map(), savePads: async () => {} }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => {}) }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: page.reportError }))
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }))

const { PadAudioUnavailable } = await import('@/lib/audio/pad-player')
const { SoundPad } = await import('./sound-pad')

let root: Root | null = null

/** Opens the Sound Pad with Recording 1 on Pad 1, its sound loading with `sound`. */
async function open(sound: Promise<unknown>) {
  page.loadPadSound.mockReturnValue(sound)
  sound.catch(() => {})
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<SoundPad />))
}

const pad = () => {
  const found = document.querySelector<HTMLButtonElement>('[data-pad="1"]')
  if (!found) throw new Error('no Pad 1')
  return found
}

async function press() {
  await act(async () => {
    pad().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

function later<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('a press on a Pad', () => {
  it('is dropped while its sound loads, so presses never start together later', async () => {
    const sound = later<AudioBuffer>()
    await open(sound.promise)
    expect(pad().getAttribute('aria-busy')).toBe('true')
    expect(pad().getAttribute('aria-label')).toBe('Pad 1. Recording 1, noise-like. Loading')
    await press()
    await press()
    await press()
    const buffer = {} as AudioBuffer
    await act(async () => sound.resolve(buffer))
    expect(page.playPadSound).not.toHaveBeenCalled()
    expect(pad().dataset.ready).toBe('true')
    expect(pad().hasAttribute('aria-busy')).toBe(false)
    await press()
    expect(page.playPadSound).toHaveBeenCalledTimes(1)
    expect(page.playPadSound).toHaveBeenCalledWith(buffer, expect.any(Function))
  })

  it('isn’t reported when the audio isn’t in this browser yet, and a press tries again', async () => {
    await open(Promise.reject(new PadAudioUnavailable(new Error('offline'))))
    expect(pad().getAttribute('aria-label')).toBe(
      'Pad 1. Recording 1, noise-like. Can’t play it yet'
    )
    expect(page.reportError).not.toHaveBeenCalled()
    expect(page.loadPadSound).toHaveBeenCalledTimes(1)
    await press()
    expect(page.loadPadSound).toHaveBeenCalledTimes(2)
    expect(page.playPadSound).not.toHaveBeenCalled()
    expect(page.reportError).not.toHaveBeenCalled()
  })

  it('reports a sound that won’t decode', async () => {
    const broken = new Error('Unable to decode audio data')
    await open(Promise.reject(broken))
    expect(page.reportError).toHaveBeenCalledWith('pad-sound-failed', broken)
    expect(page.playPadSound).not.toHaveBeenCalled()
  })
})
