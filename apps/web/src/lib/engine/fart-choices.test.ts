import { describe, expect, it } from 'vitest'
import { expectMatches } from '@/test-support/arrangement-match'
import {
  autoMapInput,
  choiceCases,
  type GoldenChoiceStep,
  goldenSong,
  libraries
} from '@/test-support/engine-golden'
import { type AutoMapRecording, arrangePitches, type SongPitches, songPitches } from './auto-map'
import {
  arrangeChoices,
  bringBackFart,
  canPlay,
  type FartChoices,
  leaveOutFart,
  noChoices,
  resetPitch,
  swapFart
} from './fart-choices'

// Fart Choices (#360) against the reference's `choices.json`: each case's changes replayed from no
// change with this port's changes, its Fart Choices and Arrangement compared after each under the
// golden data's matching rule. Inputs are the golden analyses, as in `auto-map.test.ts`.

const inputs = (ids: readonly string[]) => ids.map(autoMapInput)

/** One change, as the reference's `apply_step()` makes it. */
function apply(
  step: GoldenChoiceStep,
  choices: FartChoices | null,
  automatic: number,
  song: SongPitches,
  recordings: readonly AutoMapRecording[]
): FartChoices | null {
  const current = choices ?? noChoices(automatic)
  switch (step.op) {
    case 'swap':
      return swapFart(current, step.song_pitch, step.recording)
    case 'leave_out':
      return leaveOutFart(current, step.recording)
    case 'use_again':
      return bringBackFart(current, step.recording)
    case 'reset':
      return resetPitch(current, step.song_pitch, song, recordings)
    case 'reset_all':
      return null
    case 'set':
      return step.choices
  }
}

describe('Fart Choices match every choices.json case', () => {
  for (const library of ['full', 'small'] as const) {
    it(`on the ${library} library`, () => {
      const recordings = inputs(libraries[library])
      let states = 0
      for (const c of choiceCases.filter(c => c.library === library)) {
        const song = goldenSong(c.song)
        const pitches = songPitches(song)
        const automatic = arrangePitches(pitches, recordings).transposition
        let choices: FartChoices | null = null
        c.states.forEach((golden, i) => {
          const label = `${c.case} ${library}/${c.song} state ${i}`
          if (golden.step) choices = apply(golden.step, choices, automatic, pitches, recordings)
          expect(choices, label).toEqual(golden.choices)
          const recordingFor = new Map(
            Object.entries(golden.recording_for_pitch).map(([p, r]) => [Number(p), r])
          )
          expectMatches(
            arrangeChoices(pitches, recordings, choices),
            golden,
            recordingFor,
            song,
            label
          )
          states++
        })
      }
      expect(states).toBeGreaterThan(1000)
    })
  }
})

describe('Fart Choices', () => {
  const recordings = inputs(libraries.full)
  const pitches = songPitches(goldenSong('twinkle'))
  const auto = arrangePitches(pitches, recordings)

  it('are none again once every change is undone', () => {
    const start = noChoices(auto.transposition)
    const swapped = swapFart(start, pitches.pitches[0], '022')
    expect(swapped).not.toBeNull()
    expect(resetPitch(swapped as FartChoices, pitches.pitches[0], pitches, recordings)).toBeNull()
    expect(bringBackFart(leaveOutFart(start, '013') as FartChoices, '013')).toBeNull()
  })

  it('hold the transposition they started at', () => {
    const swapped = swapFart(noChoices(auto.transposition), pitches.pitches[0], '022')
    expect(arrangeChoices(pitches, recordings, swapped).transposition).toBe(auto.transposition)
  })

  it('let a fart play a pitch only near enough and long enough', () => {
    const t = auto.transposition
    for (const c of auto.pitches) {
      const r = recordings.find(x => x.id === c.recordingId) as AutoMapRecording
      expect(canPlay(r, c.songPitch, pitches, t)).toBe(true)
    }
    const noise = recordings.find(r => r.recordingPitchMidi === null) as AutoMapRecording
    expect(canPlay(noise, pitches.pitches[0], pitches, t)).toBe(false)
    expect(canPlay(recordings[0], (pitches.pitches.at(-1) as number) + 1, pitches, t)).toBe(false)
  })
})
