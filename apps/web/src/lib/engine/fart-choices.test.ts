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
  parseFartChoices,
  resetPitch,
  sameFartChoices,
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
          choices = apply(golden.step, choices, automatic, pitches, recordings)
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
      expect(states).toBeGreaterThan(700)
    })
  }
})

/** Whether `step` changes the pick of `pitch` to `id` itself: a later change to anything else doesn't. */
function touches(step: GoldenChoiceStep, pitch: number, id: string): boolean {
  switch (step.op) {
    case 'swap':
      return step.song_pitch === pitch || step.recording === id
    case 'leave_out':
      return step.recording === id
    case 'use_again':
      return false
    case 'reset':
      return step.song_pitch === pitch
    case 'reset_all':
    case 'set':
      return true
  }
}

describe('A fart the user picked', () => {
  it('never moves because of a later change, in any choices.json case', () => {
    let held = 0
    for (const library of ['full', 'small'] as const) {
      const recordings = inputs(libraries[library])
      for (const c of choiceCases.filter(c => c.library === library)) {
        const pitches = songPitches(goldenSong(c.song))
        const automatic = arrangePitches(pitches, recordings).transposition
        let choices: FartChoices | null = null
        let playing = arrangePitches(pitches, recordings)
        for (const golden of c.states) {
          const before = choices
          const playedBefore = new Map(playing.pitches.map(p => [p.songPitch, p.recordingId]))
          choices = apply(golden.step, choices, automatic, pitches, recordings)
          playing = arrangeChoices(pitches, recordings, choices)
          const now = new Map(playing.pitches.map(p => [p.songPitch, p.recordingId]))
          for (const [p, id] of Object.entries(before?.preferred ?? {})) {
            const pitch = Number(p)
            if (playedBefore.get(pitch) !== id || touches(golden.step, pitch, id)) continue
            expect(now.get(pitch), `${c.case} ${library}/${c.song} ${pitch}`).toBe(id)
            held++
          }
        }
      }
    }
    expect(held).toBeGreaterThan(200)
  })
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

  it('replace a pitch’s pick when the user swaps it again', () => {
    const t = auto.transposition
    const playing = new Set(auto.pitches.map(c => c.recordingId))
    /** The farts that can play `p` other than Farty's pick, the ones nobody plays first. */
    const others = (p: number) =>
      recordings
        .filter(r => !auto.pitches.some(c => c.songPitch === p && c.recordingId === r.id))
        .filter(r => canPlay(r, p, pitches, t))
        .map(r => r.id)
        .sort((a, b) => Number(playing.has(a)) - Number(playing.has(b)))
    const p = pitches.pitches.find(x => others(x).length > 1) as number
    const [first, second] = others(p)
    expect(playing.has(first)).toBe(false)

    const once = swapFart(noChoices(t), p, first) as FartChoices
    const twice = swapFart(once, p, second)

    expect(twice).toEqual({ transposition: t, preferred: { [p]: second }, excluded: [] })
    const arranged = arrangeChoices(pitches, recordings, twice)
    expect(arranged.pitches.find(c => c.songPitch === p)?.recordingId).toBe(second)
    // The first is free again: nobody played it, so unless the second was taken from another
    // pitch, which is then arranged again, it plays nothing.
    if (!playing.has(second)) {
      expect(arranged.pitches.map(c => c.recordingId)).not.toContain(first)
    }
    // The first is free for another pitch: swapped there, it takes nothing back from this one.
    const q = pitches.pitches.find(
      x =>
        x !== p && canPlay(recordings.find(r => r.id === first) as AutoMapRecording, x, pitches, t)
    )
    if (q !== undefined) {
      expect(swapFart(twice as FartChoices, q, first)?.preferred).toEqual({
        [p]: second,
        [q]: first
      })
    }
  })

  it('keep a picked fart on its pitch through later changes to other pitches and farts', () => {
    const t = auto.transposition
    const [p, ...rest] = pitches.pitches
    const playing = new Set(auto.pitches.map(c => c.recordingId))
    const mine = recordings.find(r => !playing.has(r.id) && canPlay(r, p, pitches, t))?.id as string
    let choices = swapFart(noChoices(t), p, mine) as FartChoices
    const playsMine = () =>
      arrangeChoices(pitches, recordings, choices).pitches.find(c => c.songPitch === p)?.recordingId
    expect(playsMine()).toBe(mine)

    for (const q of rest) {
      const other = recordings.find(
        r => r.id !== mine && !playing.has(r.id) && canPlay(r, q, pitches, t)
      )
      if (other) {
        choices = swapFart(choices, q, other.id) as FartChoices
        expect(playsMine()).toBe(mine)
      }
      const own = auto.pitches.find(c => c.songPitch === q)?.recordingId
      if (own && own !== mine) {
        choices = leaveOutFart(choices, own) as FartChoices
        expect(playsMine()).toBe(mine)
      }
      choices = resetPitch(choices, q, pitches, recordings) as FartChoices
      expect(playsMine()).toBe(mine)
    }
    expect(choices.preferred).toEqual({ [p]: mine })
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

describe('Fart Choices as kept and sent', () => {
  const choices: FartChoices = {
    transposition: -12,
    preferred: { 55: 'b', 60: 'a' },
    excluded: ['c']
  }

  it('are the same whatever order their picks were made in', () => {
    const reordered = { transposition: -12, preferred: { 60: 'a', 55: 'b' }, excluded: ['c'] }
    expect(sameFartChoices(choices, reordered)).toBe(true)
    expect(sameFartChoices(null, null)).toBe(true)
    expect(sameFartChoices(choices, null)).toBe(false)
    expect(sameFartChoices(choices, { ...choices, transposition: 0 })).toBe(false)
    expect(sameFartChoices(choices, { ...choices, preferred: { 55: 'b', 60: 'c' } })).toBe(false)
    expect(sameFartChoices(choices, { ...choices, excluded: [] })).toBe(false)
  })

  it('read back as they were written, in order, and refuse anything else', () => {
    expect(parseFartChoices(JSON.parse(JSON.stringify(choices)))).toEqual(choices)
    expect(
      parseFartChoices({ transposition: 0, preferred: { 60: 'a' }, excluded: ['z', 'c', 'z'] })
    ).toEqual({ transposition: 0, preferred: { 60: 'a' }, excluded: ['c', 'z'] })
    for (const value of [
      undefined,
      'choices',
      { transposition: 0, preferred: {}, excluded: [] },
      { ...choices, transposition: 24.5 },
      { ...choices, transposition: 25 },
      { ...choices, preferred: { 128: 'a' } },
      { ...choices, preferred: { 60: '' } },
      { ...choices, preferred: null },
      { ...choices, excluded: 'c' },
      { ...choices, excluded: ['../c'] }
    ]) {
      expect(parseFartChoices(value)).toBeNull()
    }
  })
})
