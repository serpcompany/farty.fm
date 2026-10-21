import { expect, test } from 'vitest'
import {
  gestureBody,
  goldenContourHz,
  goldenIndex,
  goldenRecordings,
  row
} from '../../test-support/golden'
import { NOTE_LENGTHS, readBackCents, shortestNote } from './audition'
import { midiToHz } from './numeric'

const EXPECTED_MELODIC = ['013', '017', '019', '021', '059', '084', '086', '090', '094']

// #36: from the golden gesture, contour and estimate, the same shortest note for every Recording,
// and so the same Melodic set (`AuditionTests.swift`).
test('shortest notes match the golden data', async () => {
  expect(goldenIndex.melodic_recordings).toEqual(EXPECTED_MELODIC)
  const melodic: string[] = []
  let matches = 0
  const lines = [row('id', 'shortest', 'golden', 'cents at 0.12 / 0.2 / 0.35 / 0.6 s')]
  for (const golden of goldenRecordings) {
    const estimate = golden.pitch_estimate_midi
    if (estimate === null) {
      // No estimate: Noise-like without audition.
      expect.soft(golden.shortest_note_s === null && !golden.melodic).toBe(true)
      matches++
      continue
    }
    const body = await gestureBody(golden)
    const f0 = goldenContourHz(golden)
    const shortest = shortestNote(body, f0, estimate)
    if (shortest === golden.shortest_note_s) matches++
    if (shortest !== null) melodic.push(golden.id)
    expect.soft(shortest, `${golden.id}: shortest note`).toBe(golden.shortest_note_s)
    expect
      .soft(shortest === null ? null : estimate, `${golden.id}: Recording Pitch`)
      .toBe(golden.recording_pitch_midi)
    expect.soft(shortest !== null, `${golden.id}: Melodic`).toBe(golden.melodic)

    const cents = NOTE_LENGTHS.map(
      length => readBackCents(body, f0, estimate, length)?.toPrecision(15) ?? 'unvoiced'
    )
    lines.push(
      row(golden.id, shortest ?? 'null', golden.shortest_note_s ?? 'null', cents.join(' / '))
    )
  }
  expect(melodic).toEqual(EXPECTED_MELODIC)
  lines.push(
    `Audition: shortest note matches ${matches}/${goldenRecordings.length}; Melodic: ${melodic.join(' ')}`
  )
  console.log(lines.join('\n'))
})

// The golden contour holds pYIN grid values rounded to 4 decimals. Snapping back to the grid
// recovers exactly what the reference holds; this checks that it doesn't matter.
test('the unsnapped golden contour gives the same shortest notes', async () => {
  for (const golden of goldenRecordings) {
    const estimate = golden.pitch_estimate_midi
    if (estimate === null) continue
    const f0 = Float64Array.from(golden.pitch_contour.midi, m =>
      m === null ? Number.NaN : midiToHz(m)
    )
    const shortest = shortestNote(await gestureBody(golden), f0, estimate)
    expect.soft(shortest, `${golden.id} with the 4-decimal contour`).toBe(golden.shortest_note_s)
  }
})
