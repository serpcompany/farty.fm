import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { itemKey } from './outbox'
import { type Analysis, needsSettleTime, type Recording } from './recordings'
import { memoryStorage } from './test-storage'
import { encodeWav, type PcmAudio } from './wav'

// The settle-time upgrade (#116) over a real IndexedDB (fake-indexeddb), with a fake analysis.

let page: Awaited<ReturnType<typeof openPage>>

/** A page of Pedos: fresh modules, over this browser's database. */
async function openPage() {
  vi.resetModules()
  return {
    store: await import('./recording-store'),
    upgrade: await import('./settle-time-upgrade')
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

/** A Melodic analysis as a release before #116 stored it: no settle time. */
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

/** A Recording saved with `stored` as its analysis. */
async function storedBefore116(n: number): Promise<Recording> {
  const fields = { seconds: 0.01, sampleRate: 48_000, waveform: [0.5] }
  const recording = await page.store.saveRecording(fields, encodeWav(audio(n)))
  const analysis = { state: 'analyzed', analysis: stored } as const
  return (await page.store.saveAnalysis(recording.id, analysis)) as Recording
}

const fresh = (settleSeconds: number): Analysis => ({ ...stored, settleSeconds })

async function storedNow(id: string): Promise<Recording | undefined> {
  return (await page.store.db()).get('recordings', id)
}

describe('addSettleTimes', () => {
  it('re-analyzes one Recording at a time', async () => {
    const recordings = [
      await storedBefore116(1),
      await storedBefore116(2),
      await storedBefore116(3)
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

    await page.upgrade.addSettleTimes(recordings, analyze, updated)

    expect(analyze).toHaveBeenCalledTimes(3)
    expect(most).toBe(1)
    expect(updated).toHaveBeenCalledTimes(3)
    for (const { id } of recordings) {
      const now = await storedNow(id)
      expect(now?.analysis).toEqual({ state: 'analyzed', analysis: fresh(0.12) })
    }
  })

  it('leaves the stored analysis as it was when the WAV download fails', async () => {
    const recording = await storedBefore116(1)
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

    await page.upgrade.addSettleTimes([recording], analyze, updated)

    expect(fetch).toHaveBeenCalled()
    expect(analyze).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
    const now = await storedNow(recording.id)
    expect(now).toEqual(recording)
    expect(now?.analysis).toEqual({ state: 'analyzed', analysis: stored })
    // Still without a settle time, so the next open tries again.
    expect(needsSettleTime(now as Recording)).toBe(true)
  })

  it('leaves the stored analysis as it was when re-analysis fails, and goes on', async () => {
    const failing = await storedBefore116(1)
    const next = await storedBefore116(2)
    const analyze = vi
      .fn<(audio: PcmAudio) => Promise<Analysis>>()
      .mockRejectedValueOnce(new Error('Analysis failed'))
      .mockResolvedValueOnce(fresh(0.2))
    const updated = vi.fn()

    await page.upgrade.addSettleTimes([failing, next], analyze, updated)

    const now = await storedNow(failing.id)
    expect(now).toEqual(failing)
    expect(now?.analysis.state).toBe('analyzed')
    expect(needsSettleTime(now as Recording)).toBe(true)
    expect((await storedNow(next.id))?.analysis).toEqual({
      state: 'analyzed',
      analysis: fresh(0.2)
    })
    expect(updated).toHaveBeenCalledTimes(1)
  })
})
