import { expect, test } from 'vitest'
import {
  CONTOUR_TOLERANCE_MIDI,
  compareContour,
  goldenRecordings,
  pitchBody,
  row
} from '../../test-support/golden'
import { hzToMidi, roundHalfEven } from './numeric'
import { analyzePitch, estimate } from './recording-pitch'

// #35: from the golden first burst, the Recording Pitch estimate within ±30 cents and non-null for
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
    const pitch = analyzePitch(await pitchBody(golden))
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

// #295, owner-3: a 0.257 s first burst (45 frames) voiced only in its last 4, at pYIN's 45 Hz floor
// and 48 dB below the rest. The second window counts its coverage as the head does (4 of 45), so
// it is no note. Counted against the 4 frames left, it was a note at confidence 1.
test('a few quiet frames at the end of a short first burst are no note', () => {
  const sr = 44100
  const hop = 256
  const body = new Float64Array(Math.trunc(0.257 * sr))
  for (let i = 0; i < body.length; i++) {
    const level = i < 41 * hop ? 0.5 : 0.5 * 10 ** (-48 / 20)
    body[i] = level * Math.sin((2 * Math.PI * (i < 41 * hop ? 149 : 45) * i) / sr)
  }
  const f0 = new Float64Array(45).fill(Number.NaN)
  for (let i = 41; i < 45; i++) f0[i] = 45
  const found = estimate(body, f0)
  expect(found.midi).toBeNull()
  expect(found.confidence).toBeCloseTo(4 / 45, 6)
})
