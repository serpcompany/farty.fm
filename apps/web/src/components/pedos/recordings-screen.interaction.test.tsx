import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RescanResult } from '@/lib/analysis-upgrade'
import type { Analysis, Recording } from '@/lib/recordings'
import type { Rescanning } from './pedos-provider'

// The Recordings tab's Re-scan (#282) in a DOM: which rows offer it, Re-scan all, its progress
// and what it says it changed, and a Placed Pitch that outlasts a found Recording Pitch (ADR 0017).

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => ({
  recordings: [] as Recording[],
  rescanning: null as Rescanning | null,
  rescanAll: vi.fn<() => Promise<RescanResult>>(),
  rescanRecording: vi.fn<(id: string) => Promise<RescanResult>>()
}))

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    recordings: page.recordings,
    recording: (id: string) => page.recordings.find(r => r.id === id),
    melodicRecordings: [],
    collectedNotes: new Set(),
    nowPlaying: null,
    rescanning: page.rescanning,
    rescanAll: page.rescanAll,
    rescanRecording: page.rescanRecording
  })
}))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => {}) }))

const analysis = (recordingPitchMidi: number | null): Analysis => ({
  gestureStartSeconds: 0,
  gestureEndSeconds: 0.9,
  cutAtReattack: false,
  pitchEstimateMidi: recordingPitchMidi,
  pitchConfidence: 0.5,
  recordingPitchMidi,
  shortestNoteSeconds: recordingPitchMidi === null ? null : 0.12,
  settleSeconds: null,
  version: 5
})

/** Recording `number`, analyzed with `pitch` as its Recording Pitch (null: Noise-like). */
const analyzed = (number: number, pitch: number | null, placedPitch?: number): Recording => ({
  id: `r${number}`,
  number,
  createdAt: 0,
  seconds: 1,
  sampleRate: 48000,
  waveform: [],
  placedPitch,
  analysis: { state: 'analyzed', analysis: analysis(pitch) }
})

const melodic = analyzed(1, 55)
const noNote = analyzed(2, null)
/** Placed on C3 while Noise-like; a later analysis found G3. */
const placedThenFound = analyzed(3, 55, 48)
const placedNoiseLike = analyzed(4, null, 50)
const notAnalyzed: Recording = { ...analyzed(5, null), analysis: { state: 'notAnalyzed' } }

let root: Root | null = null
let container: HTMLDivElement

async function show(recordings: Recording[], rescanning: Rescanning | null = null) {
  page.recordings = recordings
  page.rescanning = rescanning
  const { RecordingsScreen } = await import('./recordings-screen')
  await act(async () => root?.render(<RecordingsScreen />))
}

/** The button whose accessible name or text is `name`, or undefined. */
function findButton(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === name || b.textContent === name
  )
}

function button(name: string): HTMLButtonElement {
  const found = findButton(name)
  if (!found) throw new Error(`no ${name} button`)
  return found
}

const status = () => container.querySelector('[data-testid="rescan-status"]')?.textContent

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

describe('Re-scan on the Recordings tab', () => {
  it('offers Re-scan on each Recording with no note, and Re-scan all', async () => {
    await show([melodic, noNote, placedThenFound, placedNoiseLike, notAnalyzed])
    expect(findButton('Re-scan Recording 2')).toBeDefined()
    for (const n of [1, 3, 4, 5])
      expect(findButton(`Re-scan Recording ${n}`), String(n)).toBeUndefined()
    expect(button('Re-scan all').disabled).toBe(false)
    expect(status()).toBe('')
  })

  it('has no Re-scan all when every Recording has a note', async () => {
    await show([melodic, placedThenFound, placedNoiseLike])
    expect(findButton('Re-scan all')).toBeUndefined()
  })

  it('runs Re-scan all and says what changed', async () => {
    page.rescanAll.mockResolvedValue({ scanned: 3, found: 2, failed: 0 })
    await show([melodic, noNote])
    await act(async () => button('Re-scan all').click())
    expect(page.rescanAll).toHaveBeenCalledOnce()
    expect(status()).toBe('2 farts now have a note')
  })

  it('re-scans one Recording and says when it found nothing new', async () => {
    page.rescanRecording.mockResolvedValue({ scanned: 1, found: 0, failed: 0 })
    await show([melodic, noNote])
    await act(async () => button('Re-scan Recording 2').click())
    expect(page.rescanRecording).toHaveBeenCalledExactlyOnceWith('r2')
    expect(status()).toBe('No new notes')
  })

  it('shows how far Re-scan all is and the Recording it is on, with Re-scan off meanwhile', async () => {
    const another = analyzed(6, null)
    await show([noNote, another], { recordingId: 'r2', done: 1, total: 3 })
    expect(status()).toBe('Re-scanning 2 of 3')
    expect(container.querySelector('[data-testid="rescanning-2"]')).not.toBeNull()
    expect(findButton('Re-scan Recording 2')).toBeUndefined()
    expect(button('Re-scan Recording 6').disabled).toBe(true)
    expect(button('Re-scan all').disabled).toBe(true)
  })

  it('keeps showing the Placed Pitch when a later analysis found a Recording Pitch', async () => {
    await show([placedThenFound])
    const note = container.querySelector('[data-testid="recording-note"]')
    expect(note?.textContent).toBe('C3')
    expect(note?.getAttribute('aria-label')).toBe('C3, placed by ear. Move it or take it off')
    expect(container.textContent).toContain('Placed by ear')
    expect(container.textContent).not.toContain('G3')
  })
})
