import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyze, findTrim } from '@/lib/analysis/client'
import { type RescanResult, rescan, upgradeAnalyses } from '@/lib/analysis-upgrade'
import { play, stopPlayback } from '@/lib/audio/player'
import { type LibraryChange, onLibraryChanged } from '@/lib/library-changes'
import * as store from '@/lib/recording-store'
import type { Analysis, AnalysisState, Recording } from '@/lib/recordings'
import { reportError } from '@/lib/telemetry/errors'
import { songs } from '@/test-support/songs.generated'
import { PlaybackProvider, recordingSound, usePlayback } from './playback-provider'
import { RecordingsProvider, useRecordings } from './recordings-provider'
import { SongCatalogProvider } from './song-catalog-provider'

vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/recording-store', async importOriginal => ({
  savedByANewerFarty: (await importOriginal<typeof store>()).savedByANewerFarty,
  loadRecordings: vi.fn(),
  loadAudio: vi.fn(),
  saveAnalysis: vi.fn(),
  saveRecording: vi.fn(),
  deleteRecording: vi.fn(),
  placeRecording: vi.fn()
}))
vi.mock('@/lib/analysis/client', () => ({ analyze: vi.fn(), findTrim: vi.fn() }))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: vi.fn(), rescan: vi.fn() }))
vi.mock('@/lib/catalog/load-songs', () => import('@/test-support/fake-load-songs'))
vi.mock('next/navigation', () => ({ usePathname: () => '/compose/' }))
vi.mock('@/lib/library-changes', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/library-changes')>()),
  onLibraryChanged: vi.fn()
}))
vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: vi.fn() }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))
vi.mock('@/lib/wav', () => ({
  decodeWav: () => ({ samples: new Float32Array(4800), sampleRate: 48_000 })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function analysisAt(midi: number | null): Analysis {
  return {
    gestureStartSeconds: 0,
    gestureEndSeconds: 1,
    cutAtReattack: false,
    pitchEstimateMidi: midi,
    pitchConfidence: 1,
    recordingPitchMidi: midi,
    shortestNoteSeconds: midi === null ? null : 1,
    settleSeconds: midi === null ? null : 0,
    version: 99
  }
}

const analyzedAt = (midi: number | null): AnalysisState => ({
  state: 'analyzed',
  analysis: analysisAt(midi)
})

function saved(number: number, analysis: AnalysisState = { state: 'analyzing' }): Recording {
  return {
    id: `r${number}`,
    number,
    createdAt: number,
    seconds: 1,
    sampleRate: 48_000,
    waveform: [],
    analysis
  }
}

let library: ReturnType<typeof useRecordings>
let playback: ReturnType<typeof usePlayback>
let syncChanged: (change: LibraryChange) => void
let root: Root

function Probe() {
  library = useRecordings()
  playback = usePlayback()
  return null
}

const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

async function open(loaded: Recording[] | DOMException) {
  if (Array.isArray(loaded)) vi.mocked(store.loadRecordings).mockResolvedValue(loaded)
  else vi.mocked(store.loadRecordings).mockRejectedValue(loaded)
  root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <PlaybackProvider>
        <SongCatalogProvider>
          <RecordingsProvider>
            <Probe />
          </RecordingsProvider>
        </SongCatalogProvider>
      </PlaybackProvider>
    )
  )
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(onLibraryChanged).mockImplementation(listener => {
    syncChanged = listener
    return () => undefined
  })
  vi.mocked(play).mockResolvedValue(undefined)
  vi.mocked(store.loadAudio).mockResolvedValue(new ArrayBuffer(0))
  vi.mocked(analyze).mockResolvedValue(analysisAt(55))
  vi.mocked(store.saveAnalysis).mockImplementation(async (id, analysis) => ({
    ...saved(Number(id.slice(1))),
    analysis
  }))
})

afterEach(() => act(() => root.unmount()))

describe('RecordingsProvider', () => {
  it('says Farty was updated when a newer Farty saved the library, and reports it', async () => {
    const newer = new DOMException(
      'The requested version is less than the existing one',
      'VersionError'
    )
    await open(newer)

    expect(library.libraryProblem).toBe('newer')
    expect(reportError).toHaveBeenCalledWith('library-open-failed', newer)
  })

  it('says the library can’t be opened when the browser won’t let Farty read it', async () => {
    await open(new DOMException('Blocked', 'SecurityError'))

    expect(library.libraryProblem).toBe('unreadable')
  })

  it('loads the Recordings, and analyzes again one whose analysis was cut off', async () => {
    const loaded = [saved(1, analyzedAt(55)), saved(2)]
    await open(loaded)

    expect(library.recordings?.map(r => r.analysis.state)).toEqual(['analyzed', 'analyzed'])
    expect(analyze).toHaveBeenCalledOnce()
    expect(upgradeAnalyses).toHaveBeenCalledWith(loaded, analyze, expect.any(Function))
  })

  it('collects the notes and pitch classes of the Melodic Recordings', async () => {
    await open([saved(1, analyzedAt(55)), saved(2, analyzedAt(67)), saved(3, analyzedAt(null))])

    expect(library.melodicRecordings.map(r => r.id)).toEqual(['r1', 'r2'])
    expect([...library.collectedNotes].sort()).toEqual([55, 67])
    expect([...library.collectedPitchClasses]).toEqual([7])
    expect(library.songRows.map(row => row.song.id)).toEqual(songs.map(song => song.id))
    expect(library.recording('r3')?.number).toBe(3)
  })

  it('places a Noise-like Recording on a note at once, and reports a placement it could not keep', async () => {
    await open([saved(1, analyzedAt(55)), saved(2, analyzedAt(null))])
    expect(library.melodicRecordings.map(r => r.id)).toEqual(['r1'])
    const failed = new Error('QuotaExceededError')
    vi.mocked(store.placeRecording).mockRejectedValue(failed)

    await act(() => library.placeRecording('r2', { placedPitch: 48 }))

    expect(store.placeRecording).toHaveBeenCalledWith('r2', { placedPitch: 48 })
    expect(library.recording('r2')?.placedPitch).toBe(48)
    expect(library.melodicRecordings.map(r => r.id)).toEqual(['r1', 'r2'])
    expect([...library.collectedNotes].sort()).toEqual([48, 55])
    expect(findTrim).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith('recording-place-failed', failed)
  })

  it('trims a Recording to its handles, with the fart found between them, and takes the Trim off', async () => {
    await open([saved(18, analyzedAt(null))])
    const handles = { startSeconds: 0.3, endSeconds: 1.5 }
    const fart = { startSeconds: 0.45, endSeconds: 1.4 }
    vi.mocked(findTrim).mockResolvedValueOnce(fart)
    await act(() => library.placeRecording('r18', { handles }))

    const [pcm, sent] = vi.mocked(findTrim).mock.calls[0]
    expect(pcm.sampleRate).toBe(48_000)
    expect(sent).toEqual(handles)
    expect(store.placeRecording).toHaveBeenCalledWith('r18', { trim: { ...handles, fart } })
    expect(library.recording('r18')?.trim).toEqual({ ...handles, fart })

    const aroundTheFartAnalysisFound = { startSeconds: 0.001, endSeconds: 0.999 }
    vi.mocked(findTrim).mockResolvedValueOnce(aroundTheFartAnalysisFound)
    await act(() => library.placeRecording('r18', { placedPitch: 40, handles }))
    expect(store.placeRecording).toHaveBeenLastCalledWith('r18', {
      placedPitch: 40,
      trim: { ...handles, fart: aroundTheFartAnalysisFound }
    })

    await act(() => library.placeRecording('r18', { handles: null }))
    expect(store.placeRecording).toHaveBeenLastCalledWith('r18', { trim: null })
    expect(findTrim).toHaveBeenCalledTimes(2)
  })

  it("saves nothing, and says it didn't, when the fart between the handles can't be found", async () => {
    await open([saved(18, analyzedAt(null))])
    vi.mocked(findTrim).mockRejectedValueOnce(new Error('the analysis worker failed'))
    let placed: boolean | undefined
    await act(async () => {
      placed = await library.placeRecording('r18', {
        placedPitch: 40,
        handles: { startSeconds: 0.3, endSeconds: 1.5 }
      })
    })
    expect(placed).toBe(false)
    expect(reportError).toHaveBeenCalledWith('recording-trim-failed', expect.any(Error))
    expect(store.placeRecording).not.toHaveBeenCalled()
    expect(library.recording('r18')?.trim).toBeFalsy()
    expect(library.recording('r18')?.placedPitch).toBeFalsy()
  })

  it('keeps a Trim saved while a Re-scan ran: the Re-scan changes only the analysis', async () => {
    await open([saved(18, analyzedAt(null))])
    const fart = { startSeconds: 0.45, endSeconds: 1.4 }
    vi.mocked(findTrim).mockResolvedValueOnce(fart)
    await act(() =>
      library.placeRecording('r18', { handles: { startSeconds: 0.3, endSeconds: 1.5 } })
    )
    const fresh: AnalysisState = {
      state: 'analyzed',
      analysis: { ...analysisAt(null), version: 100 }
    }
    vi.mocked(rescan).mockImplementationOnce(async (_recordings, _analyze, updated) => {
      updated({ ...saved(18), analysis: fresh })
      return { scanned: 1, found: 0, failed: 0 }
    })
    await act(async () => void (await library.rescanRecording('r18')))
    expect(library.recording('r18')?.analysis).toEqual(fresh)
    expect(library.recording('r18')?.trim).toEqual({ startSeconds: 0.3, endSeconds: 1.5, fart })
  })

  it('runs one Re-scan at a time, on the Recordings it is asked for', async () => {
    await open([saved(18, analyzedAt(null)), saved(19, analyzedAt(null))])
    let finish: (result: RescanResult) => void = () => {}
    vi.mocked(rescan).mockImplementationOnce((recordings, _analyze, _updated, scanning) => {
      scanning?.(recordings[0], 0, recordings.length)
      return new Promise(resolve => {
        finish = resolve
      })
    })

    let one: Promise<RescanResult> | undefined
    let all: Promise<RescanResult> | undefined
    await act(async () => {
      one = library.rescanRecording('r18')
      all = library.rescanAll()
    })
    expect(rescan).toHaveBeenCalledOnce()
    expect(vi.mocked(rescan).mock.calls[0][0].map(r => r.id)).toEqual(['r18'])
    expect(library.rescanning).toEqual({ recordingId: 'r18', done: 0, total: 1 })
    expect(library.rescanned).toBeNull()

    const found = { scanned: 1, found: 1, failed: 0 }
    await act(async () => finish(found))
    await expect(one).resolves.toEqual(found)
    await expect(all).resolves.toEqual(found)
    expect(library.rescanning).toBeNull()
    expect(library.rescanned).toEqual(found)

    vi.mocked(rescan).mockResolvedValueOnce({ scanned: 0, found: 0, failed: 0 })
    await act(async () => void (await library.rescanAll()))
    expect(vi.mocked(rescan).mock.calls[1][0].map(r => r.id)).toEqual(['r18', 'r19'])
    expect(library.rescanned).toEqual({ scanned: 0, found: 0, failed: 0 })
  })

  it('keeps the last Re-scan’s result with no Recordings tab open, until the next one starts', async () => {
    await open([saved(18, analyzedAt(null))])
    let finish: (result: RescanResult) => void = () => {}
    vi.mocked(rescan).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )

    await act(async () => void library.rescanAll())
    await act(async () => finish({ scanned: 1, found: 1, failed: 0 }))
    expect(library.rescanned).toEqual({ scanned: 1, found: 1, failed: 0 })

    await act(async () => void library.rescanAll())
    expect(library.rescanned).toBeNull()
    await act(async () => finish({ scanned: 1, found: 0, failed: 0 }))
    expect(library.rescanned).toEqual({ scanned: 1, found: 0, failed: 0 })
  })

  it("works out a Song's Arrangement once, until the Recordings change", async () => {
    await open([saved(1, analyzedAt(55))])
    const [first] = songs
    const coverage = library.coverage(first)
    expect(library.coverage(first)).toBe(coverage)

    act(() =>
      syncChanged({
        recordings: [saved(2, analyzedAt(60))],
        toots: [],
        deleted: { recordings: [], toots: [] }
      })
    )
    expect(library.coverage(first)).not.toBe(coverage)
  })

  it('matches the Song Catalog again only when Pitch Coverage can change', async () => {
    await open([saved(1, analyzedAt(55))])
    const rows = library.songRows

    act(() =>
      syncChanged({
        recordings: [{ ...saved(1, analyzedAt(55)), number: 4 }],
        toots: [],
        deleted: { recordings: [], toots: [] }
      })
    )
    expect(library.recording('r1')?.number).toBe(4)
    expect(library.songRows).toBe(rows)

    act(() =>
      syncChanged({
        recordings: [saved(2, analyzedAt(60))],
        toots: [],
        deleted: { recordings: [], toots: [] }
      })
    )
    expect(library.songRows).not.toBe(rows)
  })

  it('reports a failed analysis and leaves the Recording not analyzed', async () => {
    vi.mocked(analyze).mockRejectedValue(new TypeError('worker failed'))
    await open([saved(1)])

    expect(reportError).toHaveBeenCalledWith('analysis-failed', expect.any(TypeError))
    expect(library.recording('r1')?.analysis.state).toBe('notAnalyzed')
  })

  it('analyzes again only a Recording that is not analyzed', async () => {
    await open([saved(1, { state: 'notAnalyzed' }), saved(2, analyzedAt(60))])

    expect(library.reanalyze('r2')).toBeNull()
    let analysis: Promise<Recording | null> | null = null
    act(() => {
      analysis = library.reanalyze('r1')
    })
    expect(library.recording('r1')?.analysis.state).toBe('analyzing')
    await act(async () => {
      await analysis
    })
    expect(library.recording('r1')?.analysis.state).toBe('analyzed')
  })

  it('saves a new Recording after the visit opens and lists it', async () => {
    await open([])
    vi.mocked(store.saveRecording).mockResolvedValue(saved(1))
    const wav = new ArrayBuffer(8)
    await act(() => library.saveRecording({ seconds: 1, sampleRate: 48_000, waveform: [] }, wav))

    expect(store.saveRecording).toHaveBeenCalledWith(
      { seconds: 1, sampleRate: 48_000, waveform: [] },
      wav
    )
    expect(library.recordings?.map(r => r.id)).toEqual(['r1'])
  })

  it('adds files as Recordings with their ids, then analyzes each', async () => {
    await open([])
    vi.mocked(store.saveRecording).mockResolvedValueOnce(saved(1)).mockResolvedValueOnce(saved(2))
    await act(() =>
      library.importRecordings([
        { id: 'r1', wav: new ArrayBuffer(8) },
        { id: 'r2', wav: new ArrayBuffer(8) }
      ])
    )

    expect(vi.mocked(store.saveRecording).mock.calls.map(call => call[2])).toEqual(['r1', 'r2'])
    expect(store.saveAnalysis).toHaveBeenCalledTimes(2)
    expect(library.recordings?.map(r => r.analysis.state)).toEqual(['analyzed', 'analyzed'])
  })

  it('stops playback before it deletes a Recording', async () => {
    await open([saved(1, analyzedAt(55)), saved(2, analyzedAt(60))])
    await act(() => library.deleteRecording('r1'))

    expect(stopPlayback).toHaveBeenCalledOnce()
    expect(store.deleteRecording).toHaveBeenCalledWith('r1')
    expect(library.recordings?.map(r => r.id)).toEqual(['r2'])
  })

  it('takes in what a sync changed, and stops a deleted Recording that plays', async () => {
    await open([saved(1, analyzedAt(55)), saved(2, analyzedAt(60))])
    act(() => playback.togglePlayback(recordingSound(saved(2, analyzedAt(60)))))

    act(() =>
      syncChanged({
        recordings: [saved(3, analyzedAt(62))],
        toots: [],
        deleted: { recordings: ['r2'], toots: [] }
      })
    )

    expect(stopPlayback).toHaveBeenCalledOnce()
    expect(library.recordings?.map(r => r.id)).toEqual(['r1', 'r3'])
    expect(upgradeAnalyses).toHaveBeenLastCalledWith(
      [saved(3, analyzedAt(62))],
      analyze,
      expect.any(Function)
    )
  })

  it('loads everything again after a sync reset', async () => {
    await open([saved(1, analyzedAt(55))])
    vi.mocked(store.loadRecordings).mockResolvedValue([saved(5, analyzedAt(64))])

    act(() => syncChanged({ reset: true }))
    await settle()

    expect(stopPlayback).toHaveBeenCalledOnce()
    expect(library.recordings?.map(r => r.id)).toEqual(['r5'])
  })
})
