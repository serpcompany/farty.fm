import type { DetachedWindowAPI } from 'happy-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'
import { button, closeScreens, pageText, show, tap } from '@/test-support/screen'
import { PlaceByEar } from './place-by-ear'
import { recordingSound } from './playback-provider'

const page = vi.hoisted(() => ({
  recording: undefined as Recording | undefined,
  placeRecording: vi.fn(),
  togglePlayback: vi.fn(),
  stopPlaying: vi.fn(),
  playPianoNote: vi.fn()
}))

vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: vi.fn() }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => undefined) }))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({
    recording: (id: string) => (page.recording?.id === id ? page.recording : undefined),
    placeRecording: page.placeRecording
  })
}))
vi.mock('./playback-provider', async importOriginal => ({
  ...(await importOriginal<typeof import('./playback-provider')>()),
  usePlayback: () => ({
    nowPlaying: null,
    togglePlayback: page.togglePlayback,
    stopPlaying: page.stopPlaying
  })
}))
vi.mock('./piano-keys', async importOriginal => ({
  ...(await importOriginal<typeof import('./piano-keys')>()),
  playPianoNote: page.playPianoNote
}))

function noiseLike(placedPitch?: number): Recording {
  return {
    id: 'a',
    number: 21,
    createdAt: 0,
    seconds: 1,
    sampleRate: 48000,
    waveform: [],
    placedPitch,
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

const onClose = vi.fn()
let rerender: ((next: ReactNode) => Promise<void>) | null = null

async function open(recording: Recording) {
  page.recording = recording
  const picker = <PlaceByEar recordingId={recording.id} onClose={onClose} />
  if (rerender) await rerender(picker)
  else rerender = await show(picker)
}

function closePicker() {
  closeScreens()
  rerender = null
  document.body.replaceChildren()
}

const octave = () => document.querySelector('[data-testid="place-octave"]')?.textContent

afterEach(() => {
  closePicker()
  vi.clearAllMocks()
})

describe('placing a Noise-like Recording by ear', () => {
  it('opens on octave 3 with nothing picked, and asks for a key', async () => {
    await open(noiseLike())
    expect(pageText()).toContain('Place Recording 21 on a note')
    expect(octave()).toBe('Octave 3C3 – B3')
    expect(button('Tap a key to choose a note').disabled).toBe(true)
    expect(button('Leave it out').disabled).toBe(false)
    expect(document.querySelectorAll('fieldset button')).toHaveLength(12)
    expect(button('C3').textContent).toBe('C3')
    expect(button('D3').textContent).toBe('D')
  })

  it('plays a piano note for the key tapped, and places the fart there on Place', async () => {
    await open(noiseLike())
    await tap(button('E3'))
    expect(page.playPianoNote).toHaveBeenCalledWith(52)
    expect(button('E3').getAttribute('aria-pressed')).toBe('true')
    expect(page.placeRecording).not.toHaveBeenCalled()

    await tap(button('Place at E3'))
    expect(page.placeRecording).toHaveBeenCalledWith('a', 52)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('leaves an unplaced fart out without keeping anything', async () => {
    await open(noiseLike())
    await tap(button('Leave it out'))
    expect(page.placeRecording).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves one octave at a time between C2 and B4, keeping the key picked', async () => {
    await open(noiseLike())
    await tap(button('Octave down'))
    expect(octave()).toBe('Octave 2C2 – B2')
    expect(button('Octave down').disabled).toBe(true)
    await tap(button('A♯2'))
    expect(page.playPianoNote).toHaveBeenCalledWith(46)

    await tap(button('Octave up'))
    await tap(button('Octave up'))
    expect(octave()).toBe('Octave 4C4 – B4')
    expect(button('Octave up').disabled).toBe(true)
    expect(button('Place at A♯2').disabled).toBe(false)
  })

  it('opens a placed fart on its note, ringed while another is picked, and moves it or takes it off', async () => {
    await open(noiseLike(36))
    expect(octave()).toBe('Octave 2C2 – B2')
    expect(button('Placed at C2').disabled).toBe(true)

    await tap(button('G2'))
    expect(button('C2').className).toContain('inset-ring-2')
    await tap(button('Move to G2'))
    expect(page.placeRecording).toHaveBeenCalledWith('a', 43)

    vi.clearAllMocks()
    closePicker()
    await open(noiseLike(36))
    await tap(button('Take it off'))
    expect(page.placeRecording).toHaveBeenCalledWith('a', null)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("shows another browser's placement while it's open, read live from the Recordings", async () => {
    await open(noiseLike())
    expect(button('Leave it out')).toBeDefined()
    await open(noiseLike(48))
    expect(button('Take it off')).toBeDefined()
    expect(button('C3').className).toContain('inset-ring-2')
    expect(button('Tap a key to choose a note').disabled).toBe(true)
    expect(octave()).toBe('Octave 3C3 – B3')
  })

  it('plays the fart from its play button', async () => {
    const recording = noiseLike()
    await open(recording)
    await tap(button('Play Recording 21, 0.9 s'))
    expect(page.togglePlayback).toHaveBeenCalledWith({
      ...recordingSound(recording),
      wav: expect.any(Function)
    })
    expect(recordingSound(recording).segment).not.toBeNull()
  })

  it('stops the fart when it closes', async () => {
    await open(noiseLike())
    await tap(button('Leave it out'))
    expect(page.stopPlaying).toHaveBeenCalledWith('a')
  })

  it('is a bottom Sheet on a phone and a Dialog from 48rem', async () => {
    await open(noiseLike())
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()

    closePicker()
    const happyDOM = (window as unknown as { happyDOM: DetachedWindowAPI }).happyDOM
    happyDOM.setViewport({ width: 375, height: 812 })
    try {
      await open(noiseLike())
      expect(document.querySelector('[data-slot="sheet-content"]')?.getAttribute('data-side')).toBe(
        'bottom'
      )
    } finally {
      happyDOM.setViewport({ width: 1024, height: 768 })
    }
  })
})
