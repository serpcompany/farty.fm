import { describe, expect, test } from 'vitest'
import {
  CONTOUR_TOLERANCE_MIDI,
  compareContour,
  decoded,
  goldenIndex,
  goldenRecordings,
  row
} from '../../test-support/golden'
import { ANALYSIS_VERSION, analyzeRecording } from './recording-analysis'

describe('analyzeRecording', () => {
  // From each fixture file at its own rate (five MP3s are 48 kHz), through the public entry
  // only: the same gestures, Melodic set, Recording Pitches (within 30 cents), shortest notes and
  // contours as the reference (`EndToEndTests.swift`).
  test('every fixture file matches the reference', async () => {
    const melodic: string[] = []
    let maxGestureSamples = 0
    let maxPitchCents = 0
    let bitExact = 0
    let maxContourMidi = 0
    const lines = [
      row(
        'id',
        'rate',
        'melodic',
        'RP Δ cents',
        'start Δ',
        'end Δ',
        'cut',
        'shortest',
        'voicing',
        'contour Δ¢'
      )
    ]
    for (const golden of goldenRecordings) {
      const file = await decoded(golden)
      const a = analyzeRecording(file.samples, file.sampleRate)
      const id = golden.id
      expect.soft(a.version).toBe(ANALYSIS_VERSION)

      const startError = a.gestureStartSample - golden.gesture.start_sample
      const endError = a.gestureEndSample - golden.gesture.end_sample
      maxGestureSamples = Math.max(maxGestureSamples, Math.abs(startError), Math.abs(endError))
      expect
        .soft(Math.abs(a.gestureStartSeconds - golden.gesture.start_s), `${id}: start`)
        .toBeLessThanOrEqual(0.01)
      expect
        .soft(Math.abs(a.gestureEndSeconds - golden.gesture.end_s), `${id}: end`)
        .toBeLessThanOrEqual(0.01)
      expect.soft(a.cutAtReattack, `${id}: cut at re-attack`).toBe(golden.gesture.cut_at_reattack)

      expect.soft(a.melodic, `${id}: Melodic`).toBe(golden.melodic)
      expect.soft(a.recordingPitchMidi !== null, `${id}: Melodic`).toBe(golden.melodic)
      expect.soft(a.noiseLikeReason, `${id}: Noise-like reason`).toBe(golden.noise_like_reason)
      let pitchCents = '-'
      if (a.recordingPitchMidi !== null && golden.recording_pitch_midi !== null) {
        const cents = Math.abs(a.recordingPitchMidi - golden.recording_pitch_midi) * 100
        maxPitchCents = Math.max(maxPitchCents, cents)
        if (a.recordingPitchMidi === golden.recording_pitch_midi) bitExact++
        pitchCents = cents === 0 ? '0 (exact)' : cents.toExponential(1)
        expect.soft(cents, `${id}: Recording Pitch`).toBeLessThanOrEqual(30)
        melodic.push(id)
      }
      expect
        .soft(a.pitchEstimateMidi === null, `${id}: estimate`)
        .toBe(golden.pitch_estimate_midi === null)
      expect.soft(a.shortestNoteSeconds, `${id}: shortest note`).toBe(golden.shortest_note_s)
      if (golden.settle_s === null || a.settleSeconds === null) {
        expect.soft(a.settleSeconds, `${id}: settle time`).toBe(golden.settle_s)
      } else {
        // Within 2 pYIN frames (`fixtures/golden/README.md`).
        expect
          .soft(Math.abs(a.settleSeconds - golden.settle_s), `${id}: settle time`)
          .toBeLessThanOrEqual((2 * 256) / 44_100)
      }
      expect
        .soft(Math.abs(a.pitchConfidence - golden.pitch_confidence), `${id}: confidence`)
        .toBeLessThan(1e-9)
      // rms_db is written with 4 decimals.
      expect.soft(Math.abs(a.rmsDb - golden.rms_db), `${id}: rms dB`).toBeLessThanOrEqual(0.0001)

      const contour = compareContour(a.contourMidi, golden)
      maxContourMidi = Math.max(maxContourMidi, contour.maxDiffMidi)
      expect.soft(a.contourMidi.length, `${id}: contour frames`).toBe(golden.pitch_contour.frames)
      expect.soft(contour.voicingAgrees, `${id}: voiced frames`).toBe(golden.pitch_contour.frames)
      expect.soft(contour.maxDiffMidi, `${id}: contour`).toBeLessThanOrEqual(CONTOUR_TOLERANCE_MIDI)

      lines.push(
        row(
          id,
          file.sampleRate,
          a.melodic === golden.melodic ? `yes (${a.melodic ? 'M' : 'N'})` : 'NO',
          pitchCents,
          startError,
          endError,
          a.cutAtReattack === golden.gesture.cut_at_reattack ? 'same' : 'DIFFERS',
          `${a.shortestNoteSeconds ?? '-'}/${golden.shortest_note_s ?? '-'}`,
          `${contour.voicingAgrees}/${golden.pitch_contour.frames}`,
          (contour.maxDiffMidi * 100).toFixed(4)
        )
      )
    }
    expect(melodic).toEqual(goldenIndex.melodic_recordings)
    lines.push(
      `End to end: max gesture error ${maxGestureSamples} samples; Recording Pitch ${bitExact}/${melodic.length} bit-identical, max error ${maxPitchCents} cents; max contour |Δ| ${(maxContourMidi * 100).toFixed(4)} cents; Melodic ${melodic.length}/${goldenRecordings.length}: ${melodic.join(' ')}`
    )
    console.log(lines.join('\n'))
  })

  test('the analysis survives a JSON round trip', async () => {
    const golden = goldenRecordings.find(g => g.id === '017')
    if (!golden) throw new Error('fixture 017 missing')
    const file = await decoded(golden)
    const a = analyzeRecording(file.samples, file.sampleRate)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })

  test.each([
    ['empty', 0, 44_100],
    ['one hop of silence', 256, 48_000],
    ['a second of silence', 48_000, 48_000]
  ])('%s is Noise-like, not an error', (_, length, rate) => {
    const a = analyzeRecording(new Float32Array(length), rate)
    expect(a.melodic).toBe(false)
    expect(a.noiseLikeReason).toBe('no_steady_pitch')
    expect(a.gestureEndSample).toBeLessThanOrEqual(Math.ceil((length * 44_100) / rate))
  })
})
