import type { DetachedWindowAPI } from 'happy-dom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recording, Trim } from '@/lib/recordings'

// The place-by-ear picker (ADR 0015) in a DOM: the octave it opens on and its bounds, the piano
// note a key plays, what Place, Move, Leave it out and Take it off keep, and its Trim (ADR 0019).

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => ({
  recording: undefined as Recording | undefined,
  placeRecording: vi.fn(),
  togglePlayback: vi.fn(),
  playRecording: vi.fn(),
  stopPlayback: vi.fn(),
  playPianoNote: vi.fn()
}))

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    recording: (id: string) => (page.recording?.id === id ? page.recording : undefined),
    nowPlaying: null,
    togglePlayback: page.togglePlayback,
    playRecording: page.playRecording,
    stopPlayback: page.stopPlayback,
    playingPart: null,
    playbackPosition: () => null,
    placeRecording: page.placeRecording
  })
}))
vi.mock('./piano-keys', async importOriginal => ({
  ...(await importOriginal<typeof import('./piano-keys')>()),
  playPianoNote: page.playPianoNote
}))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => {}) }))

/** Recording 21, Noise-like, placed on `placedPitch` or not, and trimmed to `trim` or not. */
function noiseLike(placedPitch?: number, trim?: Trim): Recording {
  return {
    id: 'a',
    number: 21,
    createdAt: 0,
    seconds: 1,
    sampleRate: 48000,
    waveform: [],
    placedPitch,
    trim,
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
}

let root: Root | null = null
let container: HTMLDivElement
const onClose = vi.fn()

async function open(recording: Recording) {
  page.recording = recording
  const { PlaceByEar } = await import('./place-by-ear')
  await act(async () => root?.render(<PlaceByEar recordingId={recording.id} onClose={onClose} />))
}

/** The button whose accessible name or text is `name`, anywhere on the page (the picker portals). */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === name || b.textContent === name
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}

async function tap(name: string) {
  await act(async () => button(name).click())
}

const octave = () => document.querySelector('[data-testid="place-octave"]')?.textContent
const readout = () => document.querySelector('[data-testid="trim-readout"]')?.textContent

/** A Trim handle by its name, or undefined while Trim is off. */
function handle(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="slider"]')].find(
    s => s.getAttribute('aria-label') === name
  )
}

async function press(target: HTMLElement | undefined, key: string, shiftKey = false) {
  if (!target) throw new Error('no handle')
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('placing a Noise-like Recording by ear', () => {
  it('opens on octave 3 with nothing picked, and asks for a key', async () => {
    await open(noiseLike())
    expect(document.body.textContent).toContain('Place Recording 21 on a note')
    expect(octave()).toBe('Octave 3C3 – B3')
    expect(button('Tap a key to choose a note').disabled).toBe(true)
    expect(button('Leave it out').disabled).toBe(false)
    // Twelve keys, C3 named in full.
    expect(document.querySelectorAll('fieldset button')).toHaveLength(12)
    expect(button('C3').textContent).toBe('C3')
    expect(button('D3').textContent).toBe('D')
  })

  it('plays a piano note for the key tapped, and places the fart there on Place', async () => {
    await open(noiseLike())
    await tap('E3')
    expect(page.playPianoNote).toHaveBeenCalledWith(52)
    expect(button('E3').getAttribute('aria-pressed')).toBe('true')
    expect(page.placeRecording).not.toHaveBeenCalled()

    await tap('Place at E3')
    expect(page.placeRecording).toHaveBeenCalledWith('a', { placedPitch: 52 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('leaves an unplaced fart out without keeping anything', async () => {
    await open(noiseLike())
    await tap('Leave it out')
    expect(page.placeRecording).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves one octave at a time between C2 and B4', async () => {
    await open(noiseLike())
    await tap('Octave down')
    expect(octave()).toBe('Octave 2C2 – B2')
    expect(button('Octave down').disabled).toBe(true)
    await tap('A♯2')
    expect(page.playPianoNote).toHaveBeenCalledWith(46)

    await tap('Octave up')
    await tap('Octave up')
    expect(octave()).toBe('Octave 4C4 – B4')
    expect(button('Octave up').disabled).toBe(true)
    // The key picked an octave away stays picked.
    expect(button('Place at A♯2').disabled).toBe(false)
  })

  it('opens a placed fart on its note, and moves it or takes it off', async () => {
    await open(noiseLike(36))
    expect(octave()).toBe('Octave 2C2 – B2')
    expect(button('Placed at C2').disabled).toBe(true)

    await tap('G2')
    // The note it's on now stays ringed while another is picked.
    expect(button('C2').className).toContain('inset-ring-2')
    await tap('Move to G2')
    expect(page.placeRecording).toHaveBeenCalledWith('a', { placedPitch: 43 })

    vi.clearAllMocks()
    await open(noiseLike(36))
    await tap('Take it off')
    expect(page.placeRecording).toHaveBeenCalledWith('a', { placedPitch: null })
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The provider's Recordings take another browser's placement (`recordingsAfter`), and the open
  // picker reads them live.
  it("shows another browser's placement while it's open", async () => {
    await open(noiseLike())
    expect(button('Leave it out')).toBeDefined()
    await open(noiseLike(48))
    expect(button('Take it off')).toBeDefined()
    expect(button('C3').className).toContain('inset-ring-2')
    expect(button('Tap a key to choose a note').disabled).toBe(true)
    expect(octave()).toBe('Octave 3C3 – B3')
  })

  it('plays just the fart from its play button', async () => {
    const recording = noiseLike()
    await open(recording)
    await tap('Play the fart in Recording 21, 0.9 s')
    expect(page.togglePlayback).toHaveBeenCalledWith(recording, {
      startSeconds: 0,
      endSeconds: 0.9
    })
  })

  it('trims the fart with its handles, and plays and keeps just that part (ADR 0019)', async () => {
    const recording = noiseLike()
    await open(recording)
    expect(handle('Where the fart ends')).toBeUndefined()

    await tap('Trim')
    expect(button('Done').getAttribute('aria-pressed')).toBe('true')
    expect(readout()).toBe('0.00 s to 0.90 s')
    expect(button('Reset to the fart Farty found').disabled).toBe(true)
    // A hundredth of a second a press, a tenth with Shift.
    await press(handle('Where the fart ends'), 'ArrowLeft', true)
    await press(handle('Where the fart ends'), 'ArrowLeft')
    await press(handle('Where the fart starts'), 'ArrowRight')
    expect(readout()).toBe('0.01 s to 0.79 s')
    expect(button('Reset to the fart Farty found').disabled).toBe(false)

    // 0.78 s, rounded down as the row shows a fart's length.
    await tap('Play the fart in Recording 21, 0.7 s')
    expect(page.togglePlayback).toHaveBeenCalledWith(recording, {
      startSeconds: 0.01,
      endSeconds: 0.79
    })
    await tap('Save trim')
    expect(page.placeRecording).toHaveBeenCalledWith('a', {
      handles: { startSeconds: 0.01, endSeconds: 0.79 }
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps a note and a trim together on Place', async () => {
    await open(noiseLike())
    await tap('Trim')
    await press(handle('Where the fart ends'), 'ArrowLeft', true)
    await tap('E3')
    await tap('Place at E3')
    expect(page.placeRecording).toHaveBeenCalledWith('a', {
      placedPitch: 52,
      handles: { startSeconds: 0, endSeconds: 0.8 }
    })
  })

  it('opens a trimmed fart on its Trim, and Reset then Remove trim takes it off', async () => {
    await open(noiseLike(48, { startSeconds: 0.2, endSeconds: 0.6 }))
    expect(button('Placed at C3').disabled).toBe(true)
    await tap('Trim')
    expect(readout()).toBe('0.20 s to 0.60 s')

    await tap('Reset to the fart Farty found')
    expect(readout()).toBe('0.00 s to 0.90 s')
    await tap('Remove trim')
    expect(page.placeRecording).toHaveBeenCalledWith('a', { handles: null })
  })

  it('leaves a moved handle unsaved on Leave it out', async () => {
    await open(noiseLike())
    await tap('Trim')
    await press(handle('Where the fart ends'), 'ArrowLeft', true)
    await tap('Leave it out')
    expect(page.placeRecording).not.toHaveBeenCalled()
  })

  it('is a bottom Sheet on a phone and a Dialog from 768px', async () => {
    await open(noiseLike())
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()

    act(() => root?.unmount())
    document.body.replaceChildren()
    const happyDOM = (window as unknown as { happyDOM: DetachedWindowAPI }).happyDOM
    happyDOM.setViewport({ width: 375, height: 812 })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await open(noiseLike())
    expect(document.querySelector('[data-slot="sheet-content"]')?.getAttribute('data-side')).toBe(
      'bottom'
    )
  })
})
