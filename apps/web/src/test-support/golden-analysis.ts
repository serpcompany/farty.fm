import { fixtureRecordingId } from '../lib/fixture-library'
import type { Recording } from '../lib/recordings'
import type { GoldenRecording } from './golden'

/**
 * A Recording of a fixture with the reference engine's analysis (`fixtures/golden/recordings/`)
 * and its Fixture Library id, the `number`th the user made. `rate` is the golden index's analysis
 * sample rate. It reads no files, so the unit tests and the journeys (`e2e/golden.ts`) share it.
 */
export function goldenAnalysisRecording(
  golden: GoldenRecording,
  number: number,
  rate: number
): Recording {
  return {
    id: fixtureRecordingId(golden.id),
    number,
    createdAt: 0,
    seconds: golden.file.frames / golden.file.sample_rate,
    sampleRate: golden.file.sample_rate,
    waveform: [],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: golden.gesture.start_sample / rate,
        gestureEndSeconds: golden.gesture.end_sample / rate,
        cutAtReattack: golden.gesture.cut_at_reattack,
        pitchEstimateMidi: golden.pitch_estimate_midi,
        pitchConfidence: golden.pitch_confidence,
        recordingPitchMidi: golden.melodic ? golden.recording_pitch_midi : null,
        shortestNoteSeconds: golden.melodic ? golden.shortest_note_s : null,
        settleSeconds: golden.melodic ? golden.settle_s : null
      }
    }
  }
}
