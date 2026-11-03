import { loadAudio, loadRecording, saveAnalysis } from './recording-store'
import {
  type Analysis,
  isLeftOut,
  needsReanalysis,
  placedPitch,
  type Recording,
  recordingPitch,
  songPitch
} from './recordings'
import { reportError } from './telemetry/errors'
import { decodeWav, type PcmAudio } from './wav'

export async function upgradeAnalyses(
  recordings: Recording[],
  analyze: (audio: PcmAudio) => Promise<Analysis>,
  updated: (recording: Recording) => void
): Promise<void> {
  for (const recording of recordings) {
    if (!needsReanalysis(recording)) continue
    const saved = await reanalyze(recording, analyze)
    if (saved && saved !== 'failed') updated(saved)
  }
}

export interface RescanResult {
  scanned: number
  found: number
  failed: number
}

export function canRescan(recording: Recording): boolean {
  return needsReanalysis(recording) && songPitch(recording) === null && !isLeftOut(recording)
}

export async function rescan(
  recordings: Recording[],
  analyze: (audio: PcmAudio) => Promise<Analysis>,
  updated: (recording: Recording) => void,
  scanning: (recording: Recording, done: number, total: number) => void = () => {}
): Promise<RescanResult> {
  const targets = recordings.filter(canRescan)
  const result: RescanResult = { scanned: 0, found: 0, failed: 0 }
  for (const [done, listed] of targets.entries()) {
    let recording: Recording | null
    try {
      recording = await loadRecording(listed.id)
    } catch {
      result.scanned++
      result.failed++
      continue
    }
    if (!recording || !canRescan(recording)) continue
    scanning(recording, done, targets.length)
    const saved = await reanalyze(recording, analyze)
    if (saved === 'failed') {
      const now = await loadRecording(recording.id).catch(() => recording)
      if (!now || !canRescan(now)) continue
      result.scanned++
      result.failed++
      continue
    }
    if (saved === null) continue
    updated(saved)
    if (placedPitch(saved) !== null) continue
    result.scanned++
    if (recordingPitch(saved) !== null) result.found++
  }
  return result
}

export function rescanSummary({ found, failed }: RescanResult): string {
  const summary =
    found === 0
      ? 'No new notes'
      : `${found} ${found === 1 ? 'fart now has' : 'farts now have'} a note`
  return failed === 0 ? summary : `${summary}. ${failed} couldn’t be read`
}

async function reanalyze(
  recording: Recording,
  analyze: (audio: PcmAudio) => Promise<Analysis>
): Promise<Recording | null | 'failed'> {
  let wav: ArrayBuffer
  try {
    wav = await loadAudio(recording.id)
  } catch {
    return 'failed'
  }
  try {
    const analysis = await analyze(decodeWav(wav))
    return await saveAnalysis(recording.id, { state: 'analyzed', analysis })
  } catch (error) {
    reportError('analysis-failed', error)
    return 'failed'
  }
}
