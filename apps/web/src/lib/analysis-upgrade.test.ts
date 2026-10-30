import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYSIS_VERSION } from './analysis/version'
import { itemKey } from './outbox'
import { type Analysis, needsReanalysis, type Recording, songPitch, trimOf } from './recordings'
import { memoryStorage } from './test-storage'
import { encodeWav, type PcmAudio } from './wav'

// The analysis upgrade (#208) over a real IndexedDB (fake-indexeddb), with a fake analysis.

let page: Awaited<ReturnType<typeof openPage>>
const reportError = vi.fn()

/** A page of Farty: fresh modules, over this browser's database. */
async function openPage() {
  vi.resetModules()
  vi.doMock('./telemetry/errors', () => ({ reportError }))
  return {
    store: await import('./recording-store'),
    upgrade: await import('./analysis-upgrade')
  }
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('navigator', {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 }))
  )
  page = await openPage()
})

afterEach(() => {
  vi.unstubAllGlobals()
  reportError.mockReset()
})

/** A Melodic analysis as a release before #116 stored it: no settle time and no version. */
const stored: Analysis = {
  gestureStartSeconds: 0.05,
  gestureEndSeconds: 0.62,
  cutAtReattack: false,
  pitchEstimateMidi: 55.1,
  pitchConfidence: 0.92,
  recordingPitchMidi: 55.13,
  shortestNoteSeconds: 0.57
}

const audio = (n: number): PcmAudio => ({
  samples: new Float32Array(480).fill(n / 10),
  sampleRate: 48_000
})

/** A Recording saved with `analysis`, `stored` unless given. */
async function storedWith(n: number, analysis: Analysis = stored): Promise<Recording> {
  const fields = { seconds: 0.01, sampleRate: 48_000, waveform: [0.5] }
  const recording = await page.store.saveRecording(fields, encodeWav(audio(n)))
  return (await page.store.saveAnalysis(recording.id, { state: 'analyzed', analysis })) as Recording
}

/** What the current Recording Analysis finds: another Recording Pitch, and its settle time. */
const fresh = (settleSeconds: number): Analysis => ({
  ...stored,
  pitchConfidence: 0.95,
  recordingPitchMidi: 55.02,
  settleSeconds,
  version: ANALYSIS_VERSION
})

async function storedNow(id: string): Promise<Recording | undefined> {
  return (await page.store.db()).get('recordings', id)
}

describe('upgradeAnalyses', () => {
  it('re-analyzes one Recording at a time', async () => {
    const noiseLike = { ...stored, recordingPitchMidi: null, shortestNoteSeconds: null }
    const recordings = [
      await storedWith(1),
      await storedWith(2, { ...stored, settleSeconds: 0.087 }),
      await storedWith(3, noiseLike)
    ]
    let running = 0
    let most = 0
    const analyze = vi.fn(async () => {
      running += 1
      most = Math.max(most, running)
      await new Promise(resolve => setTimeout(resolve, 5))
      running -= 1
      return fresh(0.12)
    })
    const updated = vi.fn()

    await page.upgrade.upgradeAnalyses(recordings, analyze, updated)

    expect(analyze).toHaveBeenCalledTimes(3)
    expect(most).toBe(1)
    expect(updated).toHaveBeenCalledTimes(3)
    for (const { id } of recordings) {
      const now = await storedNow(id)
      expect(now?.analysis).toEqual({ state: 'analyzed', analysis: fresh(0.12) })
      expect(needsReanalysis(now as Recording)).toBe(false)
    }
  })

  it('leaves alone an analysis the current Recording Analysis made', async () => {
    const current = await storedWith(1, fresh(0.12))
    const analyze = vi.fn(async () => fresh(0.3))
    const updated = vi.fn()

    await page.upgrade.upgradeAnalyses([current], analyze, updated)

    expect(analyze).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
    expect(await storedNow(current.id)).toEqual(current)
  })

  it('leaves the stored analysis as it was when the WAV download fails', async () => {
    const recording = await storedWith(1)
    // An account Recording whose WAV this browser hasn't downloaded, and the account answers 503.
    localStorage.setItem('pedos.account', 'user-a')
    const database = await page.store.db()
    await database.delete('audio', recording.id)
    await database.put(
      'downloads',
      { kind: 'recordings', id: recording.id },
      itemKey('recordings', recording.id)
    )
    const analyze = vi.fn(async () => fresh(0.12))
    const updated = vi.fn()

    await page.upgrade.upgradeAnalyses([recording], analyze, updated)

    expect(fetch).toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
    // Audio this browser can't get yet isn't an analysis failure.
    expect(reportError).not.toHaveBeenCalled()
    const now = await storedNow(recording.id)
    expect(now).toEqual(recording)
    expect(now?.analysis).toEqual({ state: 'analyzed', analysis: stored })
    // Still from an older Recording Analysis, so the next open tries again.
    expect(needsReanalysis(now as Recording)).toBe(true)
  })

  it('leaves the stored analysis as it was when re-analysis fails, and goes on', async () => {
    const failing = await storedWith(1)
    const next = await storedWith(2)
    const analyze = vi
      .fn<(audio: PcmAudio) => Promise<Analysis>>()
      .mockRejectedValueOnce(new Error('Analysis failed'))
      .mockResolvedValueOnce(fresh(0.2))
    const updated = vi.fn()

    await page.upgrade.upgradeAnalyses([failing, next], analyze, updated)

    const now = await storedNow(failing.id)
    expect(now).toEqual(failing)
    expect(now?.analysis.state).toBe('analyzed')
    expect(needsReanalysis(now as Recording)).toBe(true)
    expect((await storedNow(next.id))?.analysis).toEqual({
      state: 'analyzed',
      analysis: fresh(0.2)
    })
    expect(updated).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith('analysis-failed', new Error('Analysis failed'))
  })
})

describe('rescan (#282)', () => {
  /** What an older Recording Analysis found: no note. */
  const noNote: Analysis = {
    ...stored,
    pitchEstimateMidi: null,
    pitchConfidence: 0.1,
    recordingPitchMidi: null,
    shortestNoteSeconds: null,
    settleSeconds: null,
    version: ANALYSIS_VERSION - 1
  }
  /** What the current one finds on a fart that still has no note. */
  const stillNoNote: Analysis = { ...noNote, version: ANALYSIS_VERSION }

  it('offers Re-scan only while an older analysis says there is no note', async () => {
    const older = await storedWith(1, noNote)
    expect(page.upgrade.canRescan(older)).toBe(true)
    expect(page.upgrade.canRescan(await storedWith(2, stillNoNote))).toBe(false)
    expect(page.upgrade.canRescan(await storedWith(3, fresh(0.12)))).toBe(false)

    await page.upgrade.rescan([older], async () => stillNoNote, vi.fn())

    expect(page.upgrade.canRescan((await storedNow(older.id)) as Recording)).toBe(false)
  })

  it('re-scans one Recording with no note, and counts it when it now has a note', async () => {
    const recording = await storedWith(1, noNote)
    expect(page.upgrade.canRescan(recording)).toBe(true)
    const analyze = vi.fn(async () => fresh(0.12))
    const updated = vi.fn()

    const result = await page.upgrade.rescan([recording], analyze, updated)

    expect(result).toEqual({ scanned: 1, found: 1, failed: 0 })
    const now = await storedNow(recording.id)
    expect(now?.analysis).toEqual({ state: 'analyzed', analysis: fresh(0.12) })
    expect(updated).toHaveBeenCalledExactlyOnceWith(now)
    expect(page.upgrade.rescanSummary(result)).toBe('1 fart now has a note')
  })

  it('re-scans all with no note, one at a time, and leaves the rest alone', async () => {
    const melodic = await storedWith(1, fresh(0.12))
    const found = await storedWith(2, noNote)
    const still = await storedWith(3, noNote)
    const placed = (await page.store.placeRecording((await storedWith(4, noNote)).id, {
      placedPitch: 48
    })) as Recording
    const analyzing = await page.store.saveRecording(
      { seconds: 0.01, sampleRate: 48_000, waveform: [0.5] },
      encodeWav(audio(5))
    )
    const recordings = [melodic, found, still, placed, analyzing]
    expect(recordings.map(page.upgrade.canRescan)).toEqual([false, true, true, false, false])
    let running = 0
    let most = 0
    const analyze = vi.fn(async (pcm: PcmAudio) => {
      running += 1
      most = Math.max(most, running)
      await new Promise(resolve => setTimeout(resolve, 5))
      running -= 1
      // Fart 2 now has a note; fart 3 still has none.
      return Math.abs(pcm.samples[0] - 0.2) < 0.01 ? fresh(0.2) : stillNoNote
    })
    const updated = vi.fn()
    const scanning = vi.fn()

    const result = await page.upgrade.rescan(recordings, analyze, updated, scanning)

    expect(result).toEqual({ scanned: 2, found: 1, failed: 0 })
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(most).toBe(1)
    expect(scanning.mock.calls).toEqual([
      [found, 0, 2],
      [still, 1, 2]
    ])
    expect(updated.mock.calls.map(([r]) => r.id)).toEqual([found.id, still.id])
    expect((await storedNow(found.id))?.analysis).toEqual({
      state: 'analyzed',
      analysis: fresh(0.2)
    })
    expect(await storedNow(still.id)).toEqual({
      ...still,
      analysis: { state: 'analyzed', analysis: stillNoNote }
    })
    expect(await storedNow(melodic.id)).toEqual(melodic)
    expect(page.upgrade.rescanSummary(result)).toBe('1 fart now has a note')
  })

  it('skips one deleted before the run reaches it, and counts it nowhere', async () => {
    const first = await storedWith(1, noNote)
    const deleted = await storedWith(2, noNote)
    const analyze = vi.fn(async () => {
      await page.store.deleteRecording(deleted.id)
      return stillNoNote
    })
    const scanning = vi.fn()

    const result = await page.upgrade.rescan([first, deleted], analyze, vi.fn(), scanning)

    expect(analyze).toHaveBeenCalledOnce()
    expect(scanning.mock.calls.map(([r]) => r.id)).toEqual([first.id])
    expect(result).toEqual({ scanned: 1, found: 0, failed: 0 })
    expect(page.upgrade.rescanSummary(result)).toBe('No new notes')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('skips one placed by ear before the run reaches it, and counts it nowhere', async () => {
    const first = await storedWith(1, noNote)
    const placedMeanwhile = await storedWith(2, noNote)
    const analyze = vi.fn(async () => {
      await page.store.placeRecording(placedMeanwhile.id, { placedPitch: 48 })
      return stillNoNote
    })

    const result = await page.upgrade.rescan([first, placedMeanwhile], analyze, vi.fn())

    expect(analyze).toHaveBeenCalledOnce()
    expect(result).toEqual({ scanned: 1, found: 0, failed: 0 })
    expect(page.upgrade.rescanSummary(result)).toBe('No new notes')
    const now = (await storedNow(placedMeanwhile.id)) as Recording
    expect(now.placedPitch).toBe(48)
    expect(now.analysis).toEqual({ state: 'analyzed', analysis: noNote })
  })

  it('skips one deleted while its own analysis runs, and counts it nowhere', async () => {
    const recording = await storedWith(1, noNote)
    const analyze = vi.fn(async () => {
      await page.store.deleteRecording(recording.id)
      return fresh(0.12)
    })
    const updated = vi.fn()

    const result = await page.upgrade.rescan([recording], analyze, updated)

    expect(analyze).toHaveBeenCalledOnce()
    expect(result).toEqual({ scanned: 0, found: 0, failed: 0 })
    expect(updated).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    expect(await storedNow(recording.id)).toBeUndefined()
  })

  it('skips one deleted while its audio downloads, and counts it nowhere', async () => {
    const recording = await storedWith(1, noNote)
    // An account Recording whose WAV this browser hasn't downloaded: it's deleted meanwhile, and
    // the account answers 503.
    localStorage.setItem('pedos.account', 'user-a')
    const database = await page.store.db()
    await database.delete('audio', recording.id)
    await database.put(
      'downloads',
      { kind: 'recordings', id: recording.id },
      itemKey('recordings', recording.id)
    )
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await page.store.deleteRecording(recording.id)
      return new Response(null, { status: 503 })
    })
    const analyze = vi.fn(async () => fresh(0.12))
    const updated = vi.fn()

    const result = await page.upgrade.rescan([recording], analyze, updated)

    expect(fetch).toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
    expect(result).toEqual({ scanned: 0, found: 0, failed: 0 })
    expect(updated).not.toHaveBeenCalled()
    expect(await storedNow(recording.id)).toBeUndefined()
  })

  it('skips one placed by ear while its own analysis runs, and keeps the Placed Pitch', async () => {
    const recording = await storedWith(1, noNote)
    const analyze = vi.fn(async () => {
      await page.store.placeRecording(recording.id, { placedPitch: 48 })
      return fresh(0.12)
    })
    const updated = vi.fn()

    const result = await page.upgrade.rescan([recording], analyze, updated)

    expect(result).toEqual({ scanned: 0, found: 0, failed: 0 })
    expect(page.upgrade.rescanSummary(result)).toBe('No new notes')
    const now = (await storedNow(recording.id)) as Recording
    expect(now.placedPitch).toBe(48)
    expect(now.analysis).toEqual({ state: 'analyzed', analysis: fresh(0.12) })
    expect(updated).toHaveBeenCalledExactlyOnceWith(now)
  })

  it('counts one the database can’t read again as one it couldn’t read, and goes on', async () => {
    const unreadable = await storedWith(1, noNote)
    const failing = await storedWith(2, noNote)
    const next = await storedWith(3, noNote)
    // This browser's database fails to read `unreadable` at all, and `failing` after its analysis.
    let failingReads = 0
    vi.resetModules()
    vi.doMock('./recording-store', async importOriginal => {
      const actual = await importOriginal<typeof import('./recording-store')>()
      return {
        ...actual,
        loadRecording: async (id: string) => {
          if (id === unreadable.id || (id === failing.id && ++failingReads > 1)) {
            throw new Error('IndexedDB read failed')
          }
          return actual.loadRecording(id)
        }
      }
    })
    const { rescan, rescanSummary } = await import('./analysis-upgrade')
    vi.doUnmock('./recording-store')
    const analyze = vi.fn(async (pcm: PcmAudio) => {
      if (Math.abs(pcm.samples[0] - 0.2) < 0.01) throw new Error('Analysis failed')
      return fresh(0.2)
    })
    const updated = vi.fn()

    const run = rescan([unreadable, failing, next], analyze, updated)

    await expect(run).resolves.toEqual({ scanned: 3, found: 1, failed: 2 })
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(updated.mock.calls.map(([r]) => r.id)).toEqual([next.id])
    expect(await storedNow(unreadable.id)).toEqual(unreadable)
    expect(await storedNow(failing.id)).toEqual(failing)
    expect(rescanSummary(await run)).toBe('1 fart now has a note. 2 couldn’t be read')
  })

  it('counts one it can’t re-scan, keeps its analysis, and goes on', async () => {
    const failing = await storedWith(1, noNote)
    const next = await storedWith(2, noNote)
    const analyze = vi
      .fn<(audio: PcmAudio) => Promise<Analysis>>()
      .mockRejectedValueOnce(new Error('Analysis failed'))
      .mockResolvedValueOnce(fresh(0.2))

    const result = await page.upgrade.rescan([failing, next], analyze, vi.fn())

    expect(result).toEqual({ scanned: 2, found: 1, failed: 1 })
    expect(await storedNow(failing.id)).toEqual(failing)
    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      'analysis-failed',
      new Error('Analysis failed')
    )
    expect(page.upgrade.rescanSummary(result)).toBe('1 fart now has a note. 1 couldn’t be read')
  })

  it('says when nothing new was found', () => {
    const { rescanSummary } = page.upgrade
    expect(rescanSummary({ scanned: 3, found: 0, failed: 0 })).toBe('No new notes')
    expect(rescanSummary({ scanned: 3, found: 2, failed: 0 })).toBe('2 farts now have a note')
  })

  it('keeps a Placed Pitch when a new analysis finds a Recording Pitch (ADR 0017)', async () => {
    const older = { ...noNote, version: ANALYSIS_VERSION - 1 }
    const placed = (await page.store.placeRecording((await storedWith(1, older)).id, {
      placedPitch: 48
    })) as Recording
    expect(songPitch(placed)).toBe(48)
    const updated = vi.fn()

    await page.upgrade.upgradeAnalyses([placed], async () => fresh(0.12), updated)

    const now = (await storedNow(placed.id)) as Recording
    expect(now.placedPitch).toBe(48)
    expect(now.analysis).toEqual({ state: 'analyzed', analysis: fresh(0.12) })
    expect(songPitch(now)).toBe(48)
    expect(updated).toHaveBeenCalledExactlyOnceWith(now)
  })

  it('keeps a Trim through a Re-scan, and uses it no more once the fart is Melodic (ADR 0019)', async () => {
    const trim = {
      startSeconds: 0.002,
      endSeconds: 0.008,
      fart: { startSeconds: 0.002, endSeconds: 0.008 }
    }
    const trimmed = (await page.store.placeRecording((await storedWith(1, noNote)).id, {
      trim
    })) as Recording
    expect(page.upgrade.canRescan(trimmed)).toBe(true)

    await page.upgrade.rescan([trimmed], async () => stillNoNote, vi.fn())
    const still = (await storedNow(trimmed.id)) as Recording
    expect(still.trim).toEqual(trim)
    expect(trimOf(still)).toEqual(trim)

    // An older analysis again, and this time the Re-scan finds a note.
    const older = (await page.store.saveAnalysis(trimmed.id, {
      state: 'analyzed',
      analysis: noNote
    })) as Recording
    const result = await page.upgrade.rescan([older], async () => fresh(0.12), vi.fn())
    expect(result).toEqual({ scanned: 1, found: 1, failed: 0 })
    const found = (await storedNow(trimmed.id)) as Recording
    expect(found.trim).toEqual(trim)
    expect(trimOf(found)).toBeNull()
  })

  it('keeps a placed Recording’s Trim in use when a new analysis finds a Recording Pitch', async () => {
    const older = { ...noNote, version: ANALYSIS_VERSION - 1 }
    const trim = {
      startSeconds: 0.002,
      endSeconds: 0.008,
      fart: { startSeconds: 0.002, endSeconds: 0.008 }
    }
    const placed = (await page.store.placeRecording((await storedWith(1, older)).id, {
      placedPitch: 48,
      trim
    })) as Recording

    await page.upgrade.upgradeAnalyses([placed], async () => fresh(0.12), vi.fn())

    const now = (await storedNow(placed.id)) as Recording
    expect(now.analysis).toEqual({ state: 'analyzed', analysis: fresh(0.12) })
    expect(songPitch(now)).toBe(48)
    expect(trimOf(now)).toEqual(trim)
  })
})
