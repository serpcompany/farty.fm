import { expect, test } from 'vitest'
import { analysisAudio, goldenRecordings, row } from '../../test-support/golden'
import { ANALYSIS_SAMPLE_RATE } from './resample'
import { noteSegment } from './trimming'

// #34: from each fixture file, the gesture bounds within ±10 ms and the same "cut at re-attack"
// (`TrimmingTests.swift`).
test('gestures match the golden data', async () => {
  let maxErrorMs = 0
  const lines = [row('id', 'start', 'golden', 'end', 'golden', 'Δ samples', 'cut', 'golden')]
  for (const golden of goldenRecordings) {
    const gesture = noteSegment(await analysisAudio(golden))
    const sr = ANALYSIS_SAMPLE_RATE
    const startError = gesture.start - golden.gesture.start_sample
    const endError = gesture.end - golden.gesture.end_sample
    const errorMs = (Math.max(Math.abs(startError), Math.abs(endError)) / sr) * 1000
    maxErrorMs = Math.max(maxErrorMs, errorMs)
    lines.push(
      row(
        golden.id,
        gesture.start,
        golden.gesture.start_sample,
        gesture.end,
        golden.gesture.end_sample,
        `${startError}/${endError}`,
        gesture.cutAtReattack,
        golden.gesture.cut_at_reattack
      )
    )
    expect
      .soft(Math.abs(gesture.start / sr - golden.gesture.start_s), `${golden.id}: start`)
      .toBeLessThanOrEqual(0.01)
    expect
      .soft(Math.abs(gesture.end / sr - golden.gesture.end_s), `${golden.id}: end`)
      .toBeLessThanOrEqual(0.01)
    expect
      .soft(gesture.cutAtReattack, `${golden.id}: cut at re-attack`)
      .toBe(golden.gesture.cut_at_reattack)
  }
  lines.push(
    `Trimming: max gesture error ${maxErrorMs.toFixed(2)} ms over ${goldenRecordings.length} Recordings`
  )
  console.log(lines.join('\n'))
})
