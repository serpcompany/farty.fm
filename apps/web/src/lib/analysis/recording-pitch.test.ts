import { expect, test } from 'vitest'
import {
  CONTOUR_TOLERANCE_MIDI,
  compareContour,
  gestureBody,
  goldenRecordings,
  row
} from '../../test-support/golden'
import { hzToMidi, roundHalfEven } from './numeric'
import { analyzePitch } from './recording-pitch'

// #35: from the golden gesture, the Recording Pitch estimate within ±30 cents and non-null for
// exactly the same Recordings, the same rounded confidence, and the same contour
// (`RecordingPitchTests.swift`; the contour check is this port's addition).
test('estimates and contours match the golden data', async () => {
  let maxErrorCents = 0
  let bitExact = 0
  let estimates = 0
  let framesTotal = 0
  let framesAgreeing = 0
  let maxContourMidi = 0
  const lines = [row('id', 'estimate', 'golden', 'Δ cents', 'conf', 'golden', 'voicing', 'max Δ')]
  for (const golden of goldenRecordings) {
    const pitch = analyzePitch(await gestureBody(golden))
    const contour = Array.from(pitch.f0, f => (Number.isFinite(f) ? hzToMidi(f) : null))
    const agreement = compareContour(contour, golden)
    framesTotal += agreement.frames
    framesAgreeing += agreement.voicingAgrees
    maxContourMidi = Math.max(maxContourMidi, agreement.maxDiffMidi)
    expect.soft(contour.length, `${golden.id}: contour frames`).toBe(golden.pitch_contour.frames)
    expect.soft(agreement.voicingAgrees, `${golden.id}: voiced frames`).toBe(contour.length)
    expect
      .soft(agreement.maxDiffMidi, `${golden.id}: contour`)
      .toBeLessThanOrEqual(CONTOUR_TOLERANCE_MIDI)

    const confidence = roundHalfEven(pitch.confidence * 100) / 100
    expect
      .soft(pitch.estimateMidi === null, `${golden.id}: estimate`)
      .toBe(golden.pitch_estimate_midi === null)
    let cents = '-'
    if (pitch.estimateMidi !== null && golden.pitch_estimate_midi !== null) {
      estimates++
      if (pitch.estimateMidi === golden.pitch_estimate_midi) bitExact++
      const error = Math.abs(pitch.estimateMidi - golden.pitch_estimate_midi) * 100
      maxErrorCents = Math.max(maxErrorCents, error)
      cents = error.toFixed(2)
      expect.soft(error, `${golden.id}: estimate`).toBeLessThanOrEqual(30)
    }
    expect
      .soft(Math.abs(confidence - golden.pitch_confidence), `${golden.id}: confidence`)
      .toBeLessThan(1e-9)
    lines.push(
      row(
        golden.id,
        pitch.estimateMidi?.toFixed(4) ?? 'null',
        golden.pitch_estimate_midi?.toFixed(4) ?? 'null',
        cents,
        confidence.toFixed(2),
        golden.pitch_confidence.toFixed(2),
        `${agreement.voicingAgrees}/${agreement.frames}`,
        (agreement.maxDiffMidi * 100).toFixed(4)
      )
    )
  }
  lines.push(
    `Recording Pitch: max estimate error ${maxErrorCents.toFixed(4)} cents; ${bitExact}/${estimates} estimates bit-identical to golden`,
    `Contour: voicing agrees on ${framesAgreeing}/${framesTotal} frames; max |Δ| ${(maxContourMidi * 100).toFixed(4)} cents (golden contour is rounded to 0.005 cents)`
  )
  console.log(lines.join('\n'))
})
