import { afterEach, expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'
import { encodeWav } from '@/lib/wav'
import { closeScreens, show } from '@/test-support/screen'
import { useReplayLevels } from './recording-replay'

const barsPerQuarter = 12
const samplesPerBar = 200
const sampleRate = 4 * barsPerQuarter * samplesPerBar

const silenceLoudSilenceHalf = (() => {
  const samples = new Float32Array(sampleRate)
  for (let i = 0; i < samples.length; i++) {
    const quarter = Math.floor((4 * i) / samples.length)
    samples[i] = quarter === 1 ? 0.8 : quarter === 3 ? 0.4 : 0
  }
  return encodeWav({ samples, sampleRate })
})()

vi.mock('@/lib/recording-store', () => ({ loadAudio: async () => silenceLoudSilenceHalf }))

const cutAtTheSecondBurst: Recording = {
  id: 'a',
  number: 1,
  createdAt: 0,
  seconds: 1,
  sampleRate,
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

afterEach(closeScreens)

async function drawn(part?: { startSeconds: number; endSeconds: number }): Promise<number[]> {
  let levels: number[] = []
  function Probe() {
    levels = useReplayLevels(cutAtTheSecondBurst, part)
    return null
  }
  await show(<Probe />)
  await vi.waitFor(() => expect(levels).toHaveLength(4 * barsPerQuarter))
  return levels
}

it('draws the whole take, both bursts and the silence around them, whatever analysis found', async () => {
  const levels = await drawn()
  const quarter = (n: number) => levels.slice(n * barsPerQuarter, (n + 1) * barsPerQuarter)
  expect(quarter(0)).toEqual(Array(barsPerQuarter).fill(0.05))
  expect(quarter(1)).toEqual(Array(barsPerQuarter).fill(1))
  expect(quarter(2)).toEqual(Array(barsPerQuarter).fill(0.05))
  for (const halfAsLoudToASixteenBitStep of quarter(3)) {
    expect(halfAsLoudToASixteenBitStep).toBeCloseTo(0.5, 4)
  }
})

it('draws just the part asked for, as a Trim, scaled to its own loudest', async () => {
  const levels = await drawn({ startSeconds: 0.5, endSeconds: 1 })
  const half = 2 * barsPerQuarter
  expect(levels.slice(0, half)).toEqual(Array(half).fill(0.05))
  expect(levels.slice(half)).toEqual(Array(half).fill(1))
})
