import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RescanResult } from '@/lib/analysis-upgrade'
import type { Recording } from '@/lib/recordings'
import { encodeWav } from '@/lib/wav'

// Replaying a saved Recording on the Recordings tab plays the whole take, start to end, whatever
// its analysis found (ADR 0016): the player gets no segment. A Trim plays just its part, and
// trimming finds the fart between the handles (ADR 0019). Re-scan (#282) runs one at a time.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const audio = encodeWav({ samples: new Float32Array(480), sampleRate: 48000 })
const page = vi.hoisted(() => ({
  play: vi.fn(async (..._args: unknown[]) => {}),
  loadAudio: vi.fn(async () => audio),
  stored: [] as Recording[],
  placeRecording: vi.fn(async () => null),
  findTrim: vi.fn(),
  reportError: vi.fn(),
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
  forgetDecoded: vi.fn(),
  playbackPosition: () => null
}))
vi.mock('@/lib/recording-store', () => ({
  loadRecordings: async () => page.stored,
  loadAudio: page.loadAudio,
  placeRecording: page.placeRecording,
  onWaitingForOtherTabs: () => () => {}
}))
vi.mock('@/lib/toot-store', () => ({ loadToots: async () => [] }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/library-sync', () => ({
  onLibraryChanged: () => () => {},
  recordingsAfter: vi.fn()
}))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: async () => {}, rescan: page.rescan }))
vi.mock('@/lib/analysis/client', () => ({ analyze: vi.fn(), findTrim: page.findTrim }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: page.reportError }))

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

type Pedos = ReturnType<typeof import('./pedos-provider')['usePedos']>

/** The provider, mounted, and what it gives its screens. */
async function mount(): Promise<() => Pedos> {
  const { PedosProvider, usePedos } = await import('./pedos-provider')
  let pedos: Pedos | null = null
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
  return () => {
    if (!pedos) throw new Error('not mounted')
    return pedos
  }
}

/** The segment the player was last asked for. */
const lastSegment = () => page.play.mock.calls.at(-1)?.[2] as unknown

/** Recording 18 once Noise-like, so its Trim counts. */
const noiseLike: Recording = {
  ...twoBursts,
  analysis: {
    state: 'analyzed',
    analysis: {
      ...(twoBursts.analysis.state === 'analyzed' ? twoBursts.analysis.analysis : ({} as never)),
      pitchEstimateMidi: null,
      pitchConfidence: 0,
      recordingPitchMidi: null
    }
  }
}

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

  expect(pedos?.rescanned).toBeNull()

  const found = { scanned: 1, found: 1, failed: 0 }
  await act(async () => finish(found))
  await expect(one).resolves.toEqual(found)
  await expect(all).resolves.toEqual(found)
  expect(pedos?.rescanning).toBeNull()
  expect(pedos?.rescanned).toEqual(found)

  page.rescan.mockResolvedValueOnce({ scanned: 0, found: 0, failed: 0 })
  await act(async () => {
    await pedos?.rescanAll()
  })
  expect(page.rescan.mock.calls[1][0].map(r => r.id)).toEqual(['r18', 'r19'])
  expect(pedos?.rescanned).toEqual({ scanned: 0, found: 0, failed: 0 })
})

it('keeps the last Re-scan’s result with no Recordings tab open, until the next one starts', async () => {
  page.stored = [twoBursts]
  let finish: (result: RescanResult) => void = () => {}
  page.rescan.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
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

  await act(async () => void pedos?.rescanAll())
  // The user leaves the Recordings tab while it runs: the result waits in the provider.
  const found = { scanned: 1, found: 1, failed: 0 }
  await act(async () => finish(found))
  expect(pedos?.rescanned).toEqual(found)

  await act(async () => void pedos?.rescanAll())
  expect(pedos?.rescanned).toBeNull()
  await act(async () => finish({ scanned: 1, found: 0, failed: 0 }))
  expect(pedos?.rescanned).toEqual({ scanned: 1, found: 0, failed: 0 })
})

it("plays a trimmed Recording's Trim, and the part a scrub asks for", async () => {
  const pedos = await mount()
  // It plays the handles the user set, not the fart Songs cut between them.
  const fart = { startSeconds: 0.6, endSeconds: 1.1 }
  const trimmed = { ...noiseLike, trim: { startSeconds: 0.5, endSeconds: 1.2, fart } }
  await act(async () => pedos().togglePlayback(trimmed))
  expect(lastSegment()).toEqual({ start: 0.5, end: 1.2 })
  expect(pedos().playingPart).toEqual({ startSeconds: 0.5, endSeconds: 1.2 })

  await act(async () => pedos().playRecording(trimmed, { startSeconds: 0.9, endSeconds: 1.2 }))
  expect(lastSegment()).toEqual({ start: 0.9, end: 1.2 })
  expect(pedos().nowPlaying).toBe('r18')

  // A Melodic one plays the whole take, whatever Trim it kept from when it was Noise-like.
  await act(async () => pedos().togglePlayback({ ...twoBursts, id: 'r19', trim: trimmed.trim }))
  expect(lastSegment()).toBeNull()
})

it('trims a Recording to its handles, with the fart found between them, and takes the Trim off', async () => {
  page.stored = [noiseLike]
  const pedos = await mount()
  const handles = { startSeconds: 0.3, endSeconds: 1.5 }
  const fart = { startSeconds: 0.45, endSeconds: 1.4 }
  page.findTrim.mockResolvedValueOnce(fart)
  await act(async () => pedos().placeRecording('r18', { handles }))

  const [pcm, sent] = page.findTrim.mock.calls[0] as [{ sampleRate: number }, unknown]
  expect(pcm.sampleRate).toBe(48000)
  expect(sent).toEqual(handles)
  expect(page.placeRecording).toHaveBeenCalledWith('r18', { trim: { ...handles, fart } })
  expect(pedos().recording('r18')?.trim).toEqual({ ...handles, fart })

  // Handles around the fart analysis found still keep a Trim: exactly the handles (#299 S5).
  const found = { startSeconds: 0.401, endSeconds: 2.099 }
  page.findTrim.mockResolvedValueOnce(found)
  await act(async () => pedos().placeRecording('r18', { placedPitch: 40, handles }))
  expect(page.placeRecording).toHaveBeenLastCalledWith('r18', {
    placedPitch: 40,
    trim: { ...handles, fart: found }
  })

  await act(async () => pedos().placeRecording('r18', { handles: null }))
  expect(page.placeRecording).toHaveBeenLastCalledWith('r18', { trim: null })
  expect(page.findTrim).toHaveBeenCalledTimes(2)
})

it("saves nothing, and says it didn't, when the fart between the handles can't be found", async () => {
  page.stored = [noiseLike]
  const pedos = await mount()
  page.findTrim.mockRejectedValueOnce(new Error('the analysis worker failed'))
  let saved: boolean | undefined
  await act(async () => {
    saved = await pedos().placeRecording('r18', {
      placedPitch: 40,
      handles: { startSeconds: 0.3, endSeconds: 1.5 }
    })
  })
  expect(saved).toBe(false)
  expect(page.reportError).toHaveBeenCalledWith('recording-trim-failed', expect.any(Error))
  // Not the Placed Pitch alone either: the picker stays open to try both again.
  expect(page.placeRecording).not.toHaveBeenCalled()
  expect(pedos().recording('r18')?.trim).toBeFalsy()
  expect(pedos().recording('r18')?.placedPitch).toBeFalsy()
})

it('keeps a Trim saved while a Re-scan ran: the Re-scan changes only the analysis', async () => {
  page.stored = [noiseLike]
  const pedos = await mount()
  const fart = { startSeconds: 0.45, endSeconds: 1.4 }
  const trim = { startSeconds: 0.3, endSeconds: 1.5, fart }
  page.findTrim.mockResolvedValueOnce(fart)
  await act(async () =>
    pedos().placeRecording('r18', { handles: { startSeconds: 0.3, endSeconds: 1.5 } })
  )
  // The Re-scan read the Recording before the Trim was saved.
  const fresh =
    noiseLike.analysis.state === 'analyzed'
      ? { ...noiseLike.analysis.analysis, version: 99 }
      : ({} as never)
  page.rescan.mockImplementationOnce(async (_recordings, _analyze, updated) => {
    ;(updated as (recording: Recording) => void)({
      ...noiseLike,
      analysis: { state: 'analyzed', analysis: fresh }
    })
    return { scanned: 1, found: 0, failed: 0 }
  })
  await act(async () => void (await pedos().rescanRecording('r18')))
  const after = pedos().recording('r18')
  expect(after?.analysis).toEqual({ state: 'analyzed', analysis: fresh })
  expect(after?.trim).toEqual(trim)
})
