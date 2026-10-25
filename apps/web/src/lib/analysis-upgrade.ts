import { loadAudio, saveAnalysis } from './recording-store'
import { type Analysis, needsReanalysis, type Recording } from './recordings'
import { reportError } from './telemetry/errors'
import { decodeWav, type PcmAudio } from './wav'

/**
 * Runs the current Recording Analysis on each Recording an older one analyzed (`needsReanalysis`)
 * and stores the fresh analysis in place of the old one. The pitch contour that keeps the attack
 * (#208) finds more Recordings Melodic and moves Recording Pitches, so Pitch Coverage and
 * Auto-map change with it; the settle time (#116) comes along. `updated` gets each Recording once
 * its fresh analysis is stored. This browser's copy only: the account keeps the analysis it was
 * uploaded with, and each browser upgrades its own.
 *
 * One Recording at a time, so a take recorded meanwhile waits behind at most one of these in the
 * analysis worker, and at most one take is decoded for them at once. A WAV the sync is already
 * downloading is shared, not fetched again (`download` in `recording-store.ts`).
 *
 * If one fails (its audio can't be read or downloaded, or analysis fails), its stored analysis
 * stays exactly as it was, so the next open tries again. A failed analysis is reported
 * (`analysis-failed`); audio this browser can't get yet, such as offline, is not.
 */
export async function upgradeAnalyses(
  recordings: Recording[],
  analyze: (audio: PcmAudio) => Promise<Analysis>,
  updated: (recording: Recording) => void
): Promise<void> {
  for (const recording of recordings) {
    if (!needsReanalysis(recording)) continue
    let wav: ArrayBuffer
    try {
      wav = await loadAudio(recording.id)
    } catch {
      continue // The next open tries again.
    }
    try {
      const analysis = await analyze(decodeWav(wav))
      const saved = await saveAnalysis(recording.id, { state: 'analyzed', analysis })
      if (saved) updated(saved)
    } catch (error) {
      reportError('analysis-failed', error) // The next open tries again.
    }
  }
}
