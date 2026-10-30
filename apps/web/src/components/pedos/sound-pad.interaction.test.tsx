import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Performance } from '@/lib/performance'
import type { Recording } from '@/lib/recordings'
import type { PadTootDraft, TootDraft } from '@/lib/toot'

// The Sound Pad in a DOM: a press on a Pad whose sound isn't ready is dropped, never played later,
// and audio this browser can't get yet isn't reported, while a sound that won't decode is. Record
// keeps the presses that played as a Performance, made into a Toot to hear and save (#278).

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => ({
  loadPadSound: vi.fn(),
  playPadSound: vi.fn(),
  reportError: vi.fn(),
  makePadToot: vi.fn(),
  toggleTootPlayback: vi.fn(),
  stopPlayback: vi.fn(),
  forgetToot: vi.fn(),
  saveToToots: vi.fn()
}))

const recordingNumbered = (id: string, number: number): Recording => ({
  id,
  number,
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
})
const recording = recordingNumbered('a', 1)
/** The library: Recording 1, and for a take Recording 2 as well. */
let recordings = [recording]

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    recordings,
    recording: (id: string) => recordings.find(r => r.id === id),
    makePadToot: page.makePadToot,
    toggleTootPlayback: page.toggleTootPlayback,
    stopPlayback: page.stopPlayback,
    forgetToot: page.forgetToot,
    toot: () => undefined,
    nowPlaying: null,
    tootPlayFailed: null
  }),
  tootPlayback: (id: string) => `toot:${id}`
}))
// Save to Toots, as Song Creator's: its payment is tested there.
vi.mock('./song-creator', () => ({
  SaveToToots: (props: { draft: TootDraft; back: unknown }) => {
    page.saveToToots(props)
    return <button type="button">Save to Toots</button>
  }
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

/** Opens the Sound Pad with Recording 1 on Pad 1 and 2 on Pad 2, their sounds loading with `sound`. */
async function open(sound: Promise<unknown>) {
  page.loadPadSound.mockReturnValue(sound)
  sound.catch(() => {})
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<SoundPad />))
}

const pad = (number = 1) => {
  const found = document.querySelector<HTMLButtonElement>(`[data-pad="${number}"]`)
  if (!found) throw new Error(`no Pad ${number}`)
  return found
}

/** Presses Pad `number`, at `at` (the event's `timeStamp`, as `performance.now()`). */
async function press(number = 1, at?: number) {
  const event = new PointerEvent('pointerdown', { bubbles: true, button: 0 })
  if (at !== undefined) Object.defineProperty(event, 'timeStamp', { value: at })
  await act(async () => {
    pad(number).dispatchEvent(event)
  })
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

async function click(id: string) {
  const button = byTestId(id)
  if (!button) throw new Error(`no ${id}`)
  await act(async () => button.click())
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
  localStorage.clear()
  window.history.replaceState(null, '', '/compose/pad/')
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

describe('a take on the Sound Pad', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  beforeEach(() => {
    recordings = [recording, recordingNumbered('b', 2)]
  })
  afterEach(() => {
    recordings = [recording]
  })
  const draftOf = (performance: Performance, id = ID): PadTootDraft => ({
    id,
    song: null,
    performance,
    seconds: 1.2,
    wav: new ArrayBuffer(0)
  })

  it('keeps what played from Record to Stop, timed from the first tap, then plays its Toot', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    page.makePadToot.mockImplementation(async (performance: Performance) => draftOf(performance))
    // Before Record, a press plays and isn't kept.
    await press(1, 500)
    expect(byTestId('pad-take-state')?.textContent).toBe('Record')

    await click('pad-take-record')
    expect(page.stopPlayback).toHaveBeenCalled()
    expect(byTestId('pad-take-state')?.textContent).toBe('Recording')
    expect(document.body.textContent).not.toContain('Edit')
    const t0 = window.performance.now()
    await press(1, t0)
    await press(2, t0 + 250)
    await press(1, t0 + 600.4)
    expect(page.playPadSound).toHaveBeenCalledTimes(4)
    expect(byTestId('pad-take-state')?.textContent).toBe('0:00 of 0:30')
    await click('pad-take-stop')

    const played: Performance = {
      recordings: ['a', 'b'],
      taps: [
        [0, 0],
        [0.25, 1],
        [0.6, 0]
      ]
    }
    expect(page.makePadToot).toHaveBeenCalledWith(played, undefined)
    expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
    expect(document.body.textContent).toContain('0:01 · 3 taps of 2 Recordings')
    // Made, it plays once, and Save to Toots saves it.
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(draftOf(played))
    expect(page.saveToToots).toHaveBeenLastCalledWith({ draft: draftOf(played), back: null })
    // Kept for the return from Checkout.
    expect(JSON.parse(localStorage.getItem('pedos.padTake') ?? 'null')).toEqual({
      tootId: ID,
      performance: played
    })

    await click('pad-take-again')
    expect(byTestId('pad-take-state')?.textContent).toBe('Recording')
    expect(document.body.textContent).not.toContain('Save to Toots')
  })

  it('is nothing when Stop comes before a tap', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    await click('pad-take-record')
    await click('pad-take-stop')
    expect(page.makePadToot).not.toHaveBeenCalled()
    expect(byTestId('pad-take-state')?.textContent).toBe('Record')
  })

  it('says it couldn’t be made, and reports why', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    const broken = new Error('Rendering failed')
    page.makePadToot.mockRejectedValue(broken)
    await click('pad-take-record')
    await press(1, window.performance.now())
    await click('pad-take-stop')
    expect(document.body.textContent).toContain("Couldn't make this Toot.")
    expect(page.reportError).toHaveBeenCalledWith('toot-make-failed', broken)
  })

  it('is made again with the id it was paid for, back from Checkout, without playing', async () => {
    const played: Performance = {
      recordings: ['00000000-0000-4000-8000-00000000000a'],
      taps: [[0, 0]]
    }
    localStorage.setItem('pedos.padTake', JSON.stringify({ tootId: ID, performance: played }))
    window.history.replaceState(null, '', `/compose/pad/?toot=${ID}&checkout=done`)
    page.makePadToot.mockImplementation(async (performance: Performance, id: string) =>
      draftOf(performance, id)
    )
    await open(Promise.resolve({} as AudioBuffer))
    expect(page.makePadToot).toHaveBeenCalledWith(played, ID)
    expect(page.toggleTootPlayback).not.toHaveBeenCalled()
    expect(page.saveToToots).toHaveBeenLastCalledWith({
      draft: draftOf(played),
      back: { tootId: ID, done: true }
    })
  })

  it('isn’t made back from Checkout for another take, and the return is cleared', async () => {
    window.history.replaceState(null, '', `/compose/pad/?toot=${ID}&checkout=done`)
    await open(Promise.resolve({} as AudioBuffer))
    expect(page.makePadToot).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })
})
