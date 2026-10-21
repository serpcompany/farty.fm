import { loadAudio, saveAnalysis } from './recording-store'
import { type Analysis, needsSettleTime, type Recording, withSettleTime } from './recordings'
import { decodeWav, type PcmAudio } from './wav'

/**
 * Adds the settle time (#116) to each analysis stored before it: Recording Analysis runs again on
 * the stored audio, and only the settle time is kept (`withSettleTime`). `updated` gets each
 * Recording once its settle time is stored.
 *
 * One Recording at a time, so a take recorded meanwhile waits behind at most one of these in the
 * analysis worker, and at most one take is decoded for them at once. A WAV the sync is already
 * downloading is shared, not fetched again (`download` in `recording-store.ts`).
 *
 * If one fails (its audio can't be read or downloaded, or analysis fails), its stored analysis
 * stays exactly as it was, still without a settle time, so the next open tries again. Until then
 * Auto-map treats its settle time as unknown.
 */
export async function addSettleTimes(
  recordings: Recording[],
  analyze: (audio: PcmAudio) => Promise<Analysis>,
  updated: (recording: Recording) => void
): Promise<void> {
  for (const recording of recordings) {
    if (recording.analysis.state !== 'analyzed' || !needsSettleTime(recording)) continue
    const stored = recording.analysis.analysis
    try {
      const fresh = await analyze(decodeWav(await loadAudio(recording.id)))
      const analysis = withSettleTime(stored, fresh)
      const saved = await saveAnalysis(recording.id, { state: 'analyzed', analysis })
      if (saved) updated(saved)
    } catch {
      // The next open tries again.
    }
  }
}
