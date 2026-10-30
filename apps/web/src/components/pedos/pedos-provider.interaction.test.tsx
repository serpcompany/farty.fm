import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'

// Replaying a saved Recording on the Recordings tab plays the whole take, start to end, whatever
// its analysis found (ADR 0016): the player gets no segment.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const audio = new ArrayBuffer(8)
const page = vi.hoisted(() => ({
  play: vi.fn(async () => {}),
  loadAudio: vi.fn(async () => audio)
}))

vi.mock('@/lib/audio/player', () => ({
  play: page.play,
  stopPlayback: vi.fn(),
  forgetDecoded: vi.fn()
}))
vi.mock('@/lib/recording-store', () => ({
  loadRecordings: async () => [],
  loadAudio: page.loadAudio,
  onWaitingForOtherTabs: () => () => {}
}))
vi.mock('@/lib/toot-store', () => ({ loadToots: async () => [] }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/library-sync', () => ({
  onLibraryChanged: () => () => {},
  recordingsAfter: vi.fn()
}))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: async () => {} }))
vi.mock('@/lib/analysis/client', () => ({ analyze: vi.fn() }))

/** Recording 18, a 3.5 s take whose fart has a second burst: the gesture is 0.4 s to 2.1 s. */
const twoBursts: Recording = {
  id: 'r18',
  number: 18,
  createdAt: 0,
  seconds: 3.5,
  sampleRate: 48000,
  waveform: [],
  analysis: {
    state: 'analyzed',
    analysis: {
      gestureStartSeconds: 0.4,
      gestureEndSeconds: 2.1,
      cutAtReattack: true,
      pitchEstimateMidi: 40,
      pitchConfidence: 0.65,
      recordingPitchMidi: 40,
      shortestNoteSeconds: 0.3
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
  vi.clearAllMocks()
})

it('replays a Recording as the whole take, with no segment', async () => {
  const { PedosProvider, usePedos } = await import('./pedos-provider')
  function Replay() {
    const { togglePlayback } = usePedos()
    return (
      <button type="button" onClick={() => togglePlayback(twoBursts)}>
        Play Recording 18
      </button>
    )
  }
  await act(async () =>
    root?.render(
      <PedosProvider>
        <Replay />
      </PedosProvider>
    )
  )
  await act(async () => document.querySelector('button')?.click())

  expect(page.play).toHaveBeenCalledTimes(1)
  const [key, load, segment] = page.play.mock.calls[0] as unknown as [
    string,
    () => Promise<ArrayBuffer>,
    unknown
  ]
  expect(key).toBe('r18')
  expect(segment).toBeNull()
  // It plays the saved file itself.
  await expect(load()).resolves.toBe(audio)
  expect(page.loadAudio).toHaveBeenCalledWith('r18')
})
