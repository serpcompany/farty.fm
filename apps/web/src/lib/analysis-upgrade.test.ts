import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYSIS_VERSION } from './analysis/version'
import { itemKey } from './outbox'
import { type Analysis, needsReanalysis, type Recording } from './recordings'
import { memoryStorage } from './test-storage'
import { encodeWav, type PcmAudio } from './wav'

// The analysis upgrade (#208) over a real IndexedDB (fake-indexeddb), with a fake analysis.

let page: Awaited<ReturnType<typeof openPage>>

/** A page of Farty: fresh modules, over this browser's database. */
async function openPage() {
  vi.resetModules()
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
  })
})
