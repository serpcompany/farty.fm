import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyze } from '@/lib/analysis/client'
import { MicrophoneDeniedError, MicrophoneReleasedError } from '@/lib/audio/microphone'
import { stopPlayback } from '@/lib/audio/player'
import { startTake, type Take } from '@/lib/audio/recorder'
import {
  deleteRecording,
  loadAudio,
  loadRecordings,
  saveAnalysis,
  saveRecording
} from '@/lib/recording-store'
import type { Recording } from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import { encodeWav, type PcmAudio } from '@/lib/wav'
import { PlaybackProvider } from './playback-provider'
import { RecordFlowProvider, useRecordFlow } from './record-flow-provider'
import { RecordingsProvider, useRecordings } from './recordings-provider'

vi.mock('@/lib/audio/recorder', () => ({ startTake: vi.fn() }))
vi.mock('@/lib/recording-store', () => ({
  saveRecording: vi.fn(),
  saveAnalysis: vi.fn(),
  deleteRecording: vi.fn(),
  loadAudio: vi.fn(),
  loadRecordings: vi.fn()
}))
vi.mock('@/lib/analysis/client', () => ({ analyze: vi.fn() }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: vi.fn() }))
vi.mock('@/lib/library-changes', () => ({ onLibraryChanged: () => () => undefined }))
vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: vi.fn() }))
vi.mock('@/lib/stale-build', () => ({ holdReload: vi.fn() }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const sampleRate = 48_000

function takeAudio({ withFart }: { withFart: boolean }): PcmAudio {
  const samples = new Float32Array(sampleRate)
  if (withFart) {
    for (let i = 20_000; i < 30_000; i++) samples[i] = 0.5 * Math.sin(i / 10)
  }
  return { samples, sampleRate }
}

const newRecording: Recording = {
  id: 'r1',
  number: 1,
  createdAt: 1,
  seconds: 1,
  sampleRate,
  waveform: [],
  analysis: { state: 'analyzing' }
}

const melodicAnalysis = {
  gestureStartSeconds: 0.4,
  gestureEndSeconds: 0.6,
  cutAtReattack: false,
  pitchEstimateMidi: 57,
  pitchConfidence: 1,
  recordingPitchMidi: 57,
  shortestNoteSeconds: 0.2,
  settleSeconds: 0,
  version: 99
}

let flow: ReturnType<typeof useRecordFlow>
let library: ReturnType<typeof useRecordings>
let interrupt: () => void
let root: Root
const releaseHold = vi.fn()

function Probe() {
  flow = useRecordFlow()
  library = useRecordings()
  return null
}

function takeReturning(audio: PcmAudio) {
  vi.mocked(startTake).mockImplementation(async onInterrupted => {
    interrupt = onInterrupted
    return { stop: async () => audio, cancel: vi.fn() } satisfies Take
  })
}

async function recordAndStop(audio = takeAudio({ withFart: true })) {
  takeReturning(audio)
  await act(() => flow.startRecording())
  await act(() => flow.stopRecording())
}

const finishSaving = () => act(() => flow.saveDraft())

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(loadRecordings).mockResolvedValue([])
  vi.mocked(loadAudio).mockResolvedValue(encodeWav(takeAudio({ withFart: true })))
  vi.mocked(holdReload).mockReturnValue(releaseHold)
  vi.mocked(saveRecording).mockResolvedValue(newRecording)
  vi.mocked(analyze).mockResolvedValue(melodicAnalysis)
  vi.mocked(saveAnalysis).mockImplementation(async (id, analysis) => ({
    ...newRecording,
    id,
    analysis
  }))
  root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <PlaybackProvider>
        <RecordingsProvider>
          <RecordFlowProvider>
            <Probe />
          </RecordFlowProvider>
        </RecordingsProvider>
      </PlaybackProvider>
    )
  )
})

afterEach(() => act(() => root.unmount()))

describe('RecordFlowProvider', () => {
  it('records a take and shows it for review', async () => {
    takeReturning(takeAudio({ withFart: true }))
    await act(() => flow.startRecording())
    expect(flow.capture.kind).toBe('recording')
    expect(flow.showsRecordFlow).toBe(true)
    expect(stopPlayback).toHaveBeenCalledOnce()

    await act(() => flow.stopRecording())
    expect(flow.capture.kind).toBe('idle')
    expect(flow.flow?.kind === 'review' && flow.flow.draft.seconds).toBe(1)
  })

  it('stops a take by itself at 30 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      takeReturning(takeAudio({ withFart: true }))
      await act(() => flow.startRecording())
      await act(async () => vi.advanceTimersByTime(29_999))
      expect(flow.capture.kind).toBe('recording')

      await act(async () => vi.advanceTimersByTime(1))
      expect(flow.flow?.kind).toBe('review')
    } finally {
      vi.useRealTimers()
    }
  })

  it("says it didn't catch a take with nothing in it", async () => {
    await recordAndStop(takeAudio({ withFart: false }))

    expect(flow.problem).toBe('nothingHeard')
    expect(flow.flow).toBeNull()
  })

  it.each([
    [new MicrophoneDeniedError(), 'microphoneOff', 'mic-denied'],
    [new TypeError('no device'), 'couldNotStart', 'mic-start-failed']
  ])('explains a microphone that would not start (%s)', async (error, problem, code) => {
    vi.mocked(startTake).mockRejectedValue(error)
    await act(() => flow.startRecording())

    expect(flow.problem).toBe(problem)
    expect(reportError).toHaveBeenCalledWith(code, error)
    act(() => flow.dismissProblem())
    expect(flow.problem).toBeNull()
  })

  it('says nothing when the microphone was let go before the take began', async () => {
    vi.mocked(startTake).mockRejectedValue(new MicrophoneReleasedError())
    await act(() => flow.startRecording())

    expect(flow.capture.kind).toBe('idle')
    expect(flow.problem).toBeNull()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('loses the take when another app takes the microphone', async () => {
    takeReturning(takeAudio({ withFart: true }))
    await act(() => flow.startRecording())
    act(() => interrupt())

    expect(flow.capture.kind).toBe('idle')
    expect(flow.problem).toBe('interrupted')
  })

  it('saves the take, finds its note and shows what it changed', async () => {
    await recordAndStop()
    await finishSaving()

    expect(flow.flow).toMatchObject({ kind: 'result', id: 'r1' })
    expect(library.recording('r1')?.analysis.state).toBe('analyzed')
  })

  it('offers to save again when the save failed', async () => {
    vi.mocked(saveRecording).mockRejectedValueOnce(new TypeError('quota'))
    await recordAndStop()
    await finishSaving()
    expect(flow.flow?.kind).toBe('saveFailed')
    expect(reportError).toHaveBeenCalledWith('recording-save-failed', expect.any(TypeError))

    await finishSaving()
    expect(flow.flow?.kind).toBe('result')
  })

  it("retries a Recording whose note couldn't be found", async () => {
    vi.mocked(analyze).mockRejectedValueOnce(new TypeError('worker failed'))
    await recordAndStop()
    await finishSaving()
    expect(flow.flow?.kind).toBe('analysisFailed')

    await act(() => flow.retryAnalysis('r1'))
    expect(flow.flow?.kind).toBe('result')
  })

  it('holds off a new build until the flow closes', async () => {
    await recordAndStop()
    expect(holdReload).toHaveBeenCalledOnce()

    act(() => flow.closeFlow())
    expect(flow.flow).toBeNull()
    expect(releaseHold).toHaveBeenCalledOnce()
  })

  it('closes when its Recording leaves the library, so Record works again', async () => {
    await recordAndStop()
    await finishSaving()
    expect(flow.flow).toMatchObject({ kind: 'result', id: 'r1' })

    await act(() => library.deleteRecording('r1'))
    expect(deleteRecording).toHaveBeenCalledWith('r1')
    expect(flow.flow).toBeNull()
    expect(flow.showsRecordFlow).toBe(false)
    await act(() => flow.startRecording())
    expect(startTake).toHaveBeenCalledTimes(2)
  })

  it('starts no take while Review shows', async () => {
    await recordAndStop()
    await act(() => flow.startRecording())

    expect(startTake).toHaveBeenCalledOnce()
  })
})
