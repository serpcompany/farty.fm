import { expect, test } from 'vitest'
import {
  goldenContourHz,
  goldenIndex,
  goldenRecordings,
  pitchBody,
  row
} from '../../test-support/golden'
import { NOTE_LENGTHS, readBackCents, settleTime, shortestNote } from './audition'
import { midiToHz } from './numeric'

const EXPECTED_MELODIC = [
  '002',
  '013',
  '016',
  '017',
  '019',
  '022',
  '032',
  '059',
  '069',
  '084',
  '086',
  '090',
  '091',
  '094',
  '095',
  '096',
  '097',
  '098',
  '099',
  '100',
  '101',
  '102',
  '103',
  '104'
]

// #36: from the golden first burst, contour and estimate, the same shortest note for every Recording,
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
    const body = await pitchBody(golden)
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
    const shortest = shortestNote(await pitchBody(golden), f0, estimate)
    expect.soft(shortest, `${golden.id} with the 4-decimal contour`).toBe(golden.shortest_note_s)
  }
})

/** The settle time's tolerance (`fixtures/golden/README.md`): 2 pYIN frames of 256 samples. */
const SETTLE_TOLERANCE_SECONDS = (2 * 256) / 44_100

// #116: from the golden first burst, contour and Recording Pitch, the same settle time as the
// reference's `settle_time()` for every Melodic Recording.
test('settle times match the golden data', async () => {
  const lines = [row('id', 'settle s', 'golden', 'Δ frames')]
  let exact = 0
  let melodic = 0
  for (const golden of goldenRecordings) {
    if (!golden.melodic) {
      expect.soft(golden.settle_s, `${golden.id}: Noise-like`).toBeNull()
      continue
    }
    melodic++
    const settle = settleTime(
      await pitchBody(golden),
      goldenContourHz(golden),
      golden.recording_pitch_midi as number
    )
    const expected = golden.settle_s as number
    if (settle === expected) exact++
    expect
      .soft(Math.abs(settle - expected), `${golden.id}: settle time`)
      .toBeLessThanOrEqual(SETTLE_TOLERANCE_SECONDS)
    lines.push(
      row(golden.id, settle.toFixed(6), expected.toFixed(6), ((settle - expected) * 44_100) / 256)
    )
  }
  lines.push(`Settle time: ${exact}/${melodic} exact`)
  console.log(lines.join('\n'))
})
