import { loadAudio, loadRecording, saveAnalysis } from './recording-store'
import {
  type Analysis,
  needsReanalysis,
  placedPitch,
  type Recording,
  recordingPitch,
  songPitch
} from './recordings'
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
    const saved = await reanalyze(recording, analyze)
    if (saved && saved !== 'failed') updated(saved)
  }
}

/** What a Re-scan did (#282). */
export interface RescanResult {
  /** How many Recordings it ran on. */
  scanned: number
  /** How many of them now have a note. */
  found: number
  /** How many it couldn't run on: audio this browser can't get, or an analysis that failed. */
  failed: number
}

/**
 * Whether a Re-scan runs on the Recording: an analyzed one with no note, Noise-like and not placed
 * by ear, whose analysis an older Recording Analysis made (`needsReanalysis`). Analysis is
 * deterministic, so a Re-scan of any other Recording would find what it already has. Once
 * `upgradeAnalyses` has brought every Recording to the current analysis, nothing can be re-scanned.
 */
export function canRescan(recording: Recording): boolean {
  return needsReanalysis(recording) && songPitch(recording) === null
}

/**
 * Re-scan (#282): runs the current Recording Analysis again on each of `recordings` with no note
 * (`canRescan`), one at a time, as `upgradeAnalyses` does. Before each, it reads the Recording
 * again and skips one deleted or placed by ear since the run began, or while its own analysis
 * runs: that one counts as neither scanned, found nor failed. `scanning` gets each before it runs,
 * with how many came before it and how many there are; `updated` gets each once its fresh analysis
 * is stored. The result counts the ones whose new analysis found a Recording Pitch: they went from
 * no note to a note. A Placed Pitch is never one: a placed Recording has a note, and a new analysis
 * keeps it (ADR 0017).
 *
 * This browser's copy only, like `upgradeAnalyses`: every browser of the account runs the same
 * analysis on the same audio. One that fails, including one the database can't read again, keeps
 * its stored analysis and counts as failed, and the run goes on: it never rejects.
 */
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
      // This browser's database couldn't read it: one it couldn't read, and the run goes on.
      result.scanned++
      result.failed++
      continue
    }
    if (!recording || !canRescan(recording)) continue
    scanning(recording, done, targets.length)
    const saved = await reanalyze(recording, analyze)
    if (saved === 'failed') {
      // Deleted or placed by ear while it ran, so its audio was gone or it has a note: skipped. A
      // check that can't read it counts it as failed, as it still may be there.
      const now = await loadRecording(recording.id).catch(() => recording)
      if (!now || !canRescan(now)) continue
      result.scanned++
      result.failed++
      continue
    }
    // Deleted while it ran: its analysis had nowhere to go.
    if (saved === null) continue
    updated(saved)
    // Placed by ear while it ran: it has a note, but not one this analysis found.
    if (placedPitch(saved) !== null) continue
    result.scanned++
    if (recordingPitch(saved) !== null) result.found++
  }
  return result
}

/** What a Re-scan says it did: "2 farts now have a note", or "No new notes". */
export function rescanSummary({ found, failed }: RescanResult): string {
  const summary =
    found === 0
      ? 'No new notes'
      : `${found} ${found === 1 ? 'fart now has' : 'farts now have'} a note`
  return failed === 0 ? summary : `${summary}. ${failed} couldn’t be read`
}

/**
 * Runs the current Recording Analysis on a Recording's stored audio and stores it in place of the
 * old one: the updated Recording, null when it was deleted meanwhile, or 'failed' when its audio
 * can't be read or the analysis failed (reported as `analysis-failed`), which leaves the stored
 * analysis as it was.
 */
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
