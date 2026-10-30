import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'
import { encodeWav } from '@/lib/wav'

// A Recording's replay waveform in a DOM: the whole take, start to end, whatever the analysis
// found in it (ADR 0016), or just the part asked for, as a Trim (ADR 0019).

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * A 1 s take in four quarters: silence, a loud burst, silence, a second burst at half the level.
 */
const take = (() => {
  const sampleRate = 9600 // 200 samples a bar, 12 bars a quarter
  const samples = new Float32Array(sampleRate)
  for (let i = 0; i < samples.length; i++) {
    const quarter = Math.floor((4 * i) / samples.length)
    samples[i] = quarter === 1 ? 0.8 : quarter === 3 ? 0.4 : 0
  }
  return encodeWav({ samples, sampleRate })
})()

vi.mock('@/lib/recording-store', () => ({ loadAudio: async () => take }))

/** Analyzed with its fart from 0.25 s to 0.5 s, as an analysis that cut at the re-attack kept it. */
const recording: Recording = {
  id: 'a',
  number: 1,
  createdAt: 0,
  seconds: 1,
  sampleRate: 9600,
  waveform: [],
  analysis: {
    state: 'analyzed',
    analysis: {
      gestureStartSeconds: 0.25,
      gestureEndSeconds: 0.5,
      cutAtReattack: true,
      pitchEstimateMidi: 55,
      pitchConfidence: 0.9,
      recordingPitchMidi: 55,
      shortestNoteSeconds: 0.12
    }
  }
}

let root: Root | null = null

beforeEach(() => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

it('draws the whole take, both bursts and the silence around them', async () => {
  const { useReplayLevels } = await import('./recording-replay')
  let levels: number[] = []
  function Probe() {
    levels = useReplayLevels(recording)
    return null
  }
  await act(async () => root?.render(<Probe />))
  await vi.waitFor(() => expect(levels).toHaveLength(48))

  const quarter = (n: number) => levels.slice(n * 12, (n + 1) * 12)
  expect(quarter(0)).toEqual(Array(12).fill(0.05))
  expect(quarter(1)).toEqual(Array(12).fill(1))
  expect(quarter(2)).toEqual(Array(12).fill(0.05))
  // 16-bit PCM: the second burst is half the first, to within a sample step.
  for (const level of quarter(3)) expect(level).toBeCloseTo(0.5, 4)
})

it('draws just the part asked for, scaled to its own loudest', async () => {
  const { useReplayLevels } = await import('./recording-replay')
  let levels: number[] = []
  function Probe() {
    levels = useReplayLevels(recording, { startSeconds: 0.5, endSeconds: 1 })
    return null
  }
  await act(async () => root?.render(<Probe />))
  await vi.waitFor(() => expect(levels).toHaveLength(48))

  // The silence, then the second burst, which is now the loudest.
  expect(levels.slice(0, 24)).toEqual(Array(24).fill(0.05))
  expect(levels.slice(24)).toEqual(Array(24).fill(1))
})
