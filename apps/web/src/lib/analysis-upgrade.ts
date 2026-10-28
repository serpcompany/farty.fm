import { loadAudio, saveAnalysis } from './recording-store'
import { type Analysis, needsReanalysis, type Recording } from './recordings'
import { reportError } from './telemetry/errors'
import { decodeWav, type PcmAudio } from './wav'

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
      continue
    }
    try {
      const analysis = await analyze(decodeWav(wav))
      const saved = await saveAnalysis(recording.id, { state: 'analyzed', analysis })
      if (saved) updated(saved)
    } catch (error) {
      reportError('analysis-failed', error)
    }
  }
}
