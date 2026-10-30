import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RescanResult } from '@/lib/analysis-upgrade'
import type { Recording } from '@/lib/recordings'

// Replaying a saved Recording on the Recordings tab plays the whole take, start to end, whatever
// its analysis found (ADR 0016): the player gets no segment. Re-scan (#282) runs one at a time.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const audio = new ArrayBuffer(8)
const page = vi.hoisted(() => ({
  play: vi.fn(async () => {}),
  loadAudio: vi.fn(async () => audio),
  stored: [] as Recording[],
  rescan:
    vi.fn<
      (
        recordings: Recording[],
        analyze: unknown,
        updated: unknown,
        scanning: (recording: Recording, done: number, total: number) => void
      ) => Promise<RescanResult>
    >()
}))

vi.mock('@/lib/audio/player', () => ({
  play: page.play,
  stopPlayback: vi.fn(),
  forgetDecoded: vi.fn()
}))
vi.mock('@/lib/recording-store', () => ({
  loadRecordings: async () => page.stored,
  loadAudio: page.loadAudio,
  onWaitingForOtherTabs: () => () => {}
}))
vi.mock('@/lib/toot-store', () => ({ loadToots: async () => [] }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/library-sync', () => ({
  onLibraryChanged: () => () => {},
  recordingsAfter: vi.fn()
}))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: async () => {}, rescan: page.rescan }))
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
  page.stored = []
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

it('runs one Re-scan at a time, on the Recordings it is asked for', async () => {
  const other = { ...twoBursts, id: 'r19', number: 19 }
  page.stored = [twoBursts, other]
  let finish: (result: RescanResult) => void = () => {}
  page.rescan.mockImplementationOnce((recordings, _analyze, _updated, scanning) => {
    scanning(recordings[0], 0, recordings.length)
    return new Promise(resolve => {
      finish = resolve
    })
  })
  const { PedosProvider, usePedos } = await import('./pedos-provider')
  let pedos: ReturnType<typeof usePedos> | undefined
  function Probe() {
    pedos = usePedos()
    return null
  }
  await act(async () =>
    root?.render(
      <PedosProvider>
        <Probe />
      </PedosProvider>
    )
  )

  let one: Promise<RescanResult> | undefined
  let all: Promise<RescanResult> | undefined
  await act(async () => {
    one = pedos?.rescanRecording('r18')
    all = pedos?.rescanAll()
  })
  // Re-scan all waits for the one running.
  expect(page.rescan).toHaveBeenCalledOnce()
  expect(page.rescan.mock.calls[0][0].map(r => r.id)).toEqual(['r18'])
  expect(pedos?.rescanning).toEqual({ recordingId: 'r18', done: 0, total: 1 })

  const found = { scanned: 1, found: 1, failed: 0 }
  await act(async () => finish(found))
  await expect(one).resolves.toEqual(found)
  await expect(all).resolves.toEqual(found)
  expect(pedos?.rescanning).toBeNull()

  page.rescan.mockResolvedValueOnce({ scanned: 0, found: 0, failed: 0 })
  await act(async () => {
    await pedos?.rescanAll()
  })
  expect(page.rescan.mock.calls[1][0].map(r => r.id)).toEqual(['r18', 'r19'])
})
