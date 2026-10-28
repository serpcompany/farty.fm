import { describe, expect, it } from 'vitest'
import {
  autoMapInput,
  autoMapInputs,
  goldenArrangement,
  goldenRecording,
  goldenSong,
  type Library,
  libraries,
  songIds,
  storedAnalysis,
  syntheticRecording
} from '@/test-support/engine-golden'
import { goldenRecordings } from '@/test-support/golden'
import {
  arrange,
  autoMapRecording,
  compareIds,
  fills,
  HIGHEST_TRANSPOSITION,
  LOWEST_TRANSPOSITION,
  moveCost,
  NOTE_FILL,
  neededSeconds,
  silentCost,
  tooShortCost,
  unsettledCost
} from './auto-map'
import type { Song } from './song'

const SR = 44100

function inWholeSamples(seconds: number): number {
  return Math.round(seconds * SR) / SR
}

describe('Auto-map inputs', () => {
  it('reads the gesture length in whole samples from a stored analysis', () => {
    for (const g of goldenRecordings) {
      expect(autoMapRecording(g.id, storedAnalysis(g))).toEqual(autoMapInput(g.id))
    }
  })

  it('reads an analysis stored before the settle time as an unknown settle time', () => {
    const g = goldenRecording('017')
    const { settleSeconds: _, ...beforeSettleTime } = storedAnalysis(g)
    expect(autoMapRecording(g.id, beforeSettleTime)).toEqual({
      ...autoMapInput(g.id),
      settleSeconds: null
    })
  })

  it('costs an unknown settle time nothing, like one that is settled at once', () => {
    const song = goldenSong('birthday')
    const unknown = autoMapInputs(libraries.full).map(r => ({ ...r, settleSeconds: null }))
    const atOnce = autoMapInputs(libraries.full).map(r => ({ ...r, settleSeconds: 0 }))
    expect(arrange(song, unknown)).toEqual(arrange(song, atOnce))
    expect(arrange(song, autoMapInputs(libraries.full)).cost).toBeGreaterThan(
      arrange(song, unknown).cost
    )
  })

  it('leaves a Song locked, at the lowest transposition, when no Recording is Melodic', () => {
    const song = goldenSong('mary')
    const noise = autoMapInputs(['009', '018', '052'])
    expect(noise.every(r => r.recordingPitchMidi === null)).toBe(true)
    const a = arrange(song, noise)
    expect(a.transposition).toBe(LOWEST_TRANSPOSITION)
    expect(a.covered).toBe(0)
    expect(a.unlocked).toBe(false)
    const pitches = [...new Set(song.notes.map(n => n.pitch))].sort((x, y) => x - y)
    expect(a.missingNotes.map(m => m.midi)).toEqual(pitches.map(p => p + LOWEST_TRANSPOSITION))
    expect(arrange(song, []).missingNotes).toEqual(a.missingNotes)
    expect(HIGHEST_TRANSPOSITION).toBe(24)
  })
})

describe('the unlock rule', () => {
  it('allows a move of 3 semitones, or 3 from an octave, either way', () => {
    expect(moveCost(0)).toEqual({ cost: 0, octaveMove: false })
    expect(moveCost(-3)).toEqual({ cost: 3 ** 1.5, octaveMove: false })
    expect(moveCost(3.01)).toBeNull()
    expect(moveCost(8.99)).toBeNull()
    expect(moveCost(9)).toEqual({ cost: 6 + 3 ** 1.5, octaveMove: true })
    expect(moveCost(-12)).toEqual({ cost: 6, octaveMove: true })
    expect(moveCost(15)).toEqual({ cost: 6 + 3 ** 1.5, octaveMove: true })
    expect(moveCost(15.01)).toBeNull()
  })

  it('covers a pitch only with a Recording as long as its longest note, which no move lengthens', () => {
    expect(NOTE_FILL).toBe(1)
    expect(fills(1, 1)).toBe(true)
    expect(fills(0.99, 1)).toBe(false)
    const quarterThenHalfAt120: Song = {
      bpm: 120,
      beats_per_bar: 4,
      length_beats: 3,
      notes: [
        { start: 0, dur: 1, pitch: 60 },
        { start: 1, dur: 2, pitch: 60 }
      ]
    }
    const fartAtMiddleC = (gestureSeconds: number) => [
      syntheticRecording('a', 60, { gestureSeconds, shortestNoteSeconds: 0.12 })
    ]
    expect(arrange(quarterThenHalfAt120, fartAtMiddleC(1))).toMatchObject({
      unlocked: true,
      transposition: 0,
      octaveMoves: 0
    })
    expect(arrange(quarterThenHalfAt120, fartAtMiddleC(0.8))).toMatchObject({
      unlocked: false,
      missingNotes: [{ midi: 60 + LOWEST_TRANSPOSITION, seconds: 1 }]
    })
  })

  it('says how long a fart each missing note needs, rounded up to 0.1 s without float noise', () => {
    expect(neededSeconds(0.975)).toBe(1)
    expect(neededSeconds(0.475)).toBe(0.5)
    expect(neededSeconds(2.975)).toBe(3)
    const sevenTenthsWithFloatNoise = 0.7
    expect(neededSeconds(sevenTenthsWithFloatNoise)).toBe(0.7)
  })

  it('says the shortest length, in tenths of a second, that fills every pitch of every Song', () => {
    let pitches = 0
    for (const id of songIds) {
      const song = goldenSong(id)
      const spb = 60 / song.bpm
      for (const p of new Set(song.notes.map(n => n.pitch))) {
        const longestAsArrangeMeasuresIt = Math.max(
          ...song.notes.filter(n => n.pitch === p).map(n => n.dur * spb - 0.025)
        )
        const needed = neededSeconds(longestAsArrangeMeasuresIt)
        const label = `${id} ${p}: ${needed} s`
        expect(fills(inWholeSamples(needed), longestAsArrangeMeasuresIt), label).toBe(true)
        expect(fills(inWholeSamples(needed - 0.1), longestAsArrangeMeasuresIt), label).toBe(false)
        pitches++
      }
    }
    expect(pitches).toBeGreaterThan(70)
  })

  it('unlocks a locked Song with farts as long as it says, 3 semitones or an octave from each note', () => {
    let locked = 0
    let lockedInGolden = 0
    for (const library of Object.keys(libraries) as Library[]) {
      const recordings = autoMapInputs(libraries[library])
      for (const id of songIds) {
        if (!goldenArrangement(library, id).unlocked) lockedInGolden++
        const song = goldenSong(id)
        const { unlocked, missingNotes } = arrange(song, recordings)
        if (unlocked) continue
        locked++
        for (const fromNote of [-3, 3, -12, 12]) {
          const farts = missingNotes.map(m =>
            syntheticRecording(`new-${m.midi}`, m.midi + fromNote, {
              gestureSeconds: inWholeSamples(m.seconds)
            })
          )
          expect(
            arrange(song, [...recordings, ...farts]).unlocked,
            `${id} on the ${library} library, farts ${fromNote} semitones from ${missingNotes.map(m => `${m.midi} (${m.seconds} s)`).join(', ')}`
          ).toBe(true)
        }
      }
    }
    expect(locked).toBe(lockedInGolden)
    expect(locked).toBeGreaterThan(0)
  })
})

describe('the cost terms', () => {
  it('charges notes that sound shorter than the Recording can settle, a short gesture sounding only its own length', () => {
    expect(tooShortCost([0.5], 1, 0.35)).toBe(0)
    expect(tooShortCost([0.3], 1, 0.35)).toBeCloseTo(8 + 400 * 0.05, 9)
    expect(tooShortCost([0.5], 0.4, 0.6)).toBeCloseTo(8 + 400 * 0.2, 9)
    expect(tooShortCost([0.5, 0.2, 0.4], 0.3, 0.35)).toBeCloseTo(
      3 * 8 + 400 * (0.05 + 0.15 + 0.05),
      9
    )
  })

  it('charges the share of each note played before the Recording settles', () => {
    expect(unsettledCost([0.5], 1, 0.1)).toBeCloseTo(20 * 0.2, 9)
    expect(unsettledCost([0.05], 1, 0.1)).toBeCloseTo(20, 9)
    expect(unsettledCost([2], 1, 0.1)).toBeCloseTo(20 * 0.1, 9)
    const shortGestureSoundsQuarterSecond = 0.25
    expect(unsettledCost([0.5], shortGestureSoundsQuarterSecond, 0.1)).toBeCloseTo(20 * 0.4, 9)
    expect(unsettledCost([0.5, 0.05], 1, 0)).toBe(0)
  })

  it('charges the seconds of each note the Recording is too short to fill', () => {
    expect(silentCost([1, 0.3], 0.4)).toBeCloseTo(30 * 0.6, 9)
    expect(silentCost([0.3], 0.4)).toBe(0)
  })

  it('orders ids by code point', () => {
    expect(['b', 'a', '10', '9', 'Z', 'é', '😀', 'ｚ'].sort(compareIds)).toEqual([
      '10',
      '9',
      'Z',
      'a',
      'b',
      'é',
      'ｚ',
      '😀'
    ])
    expect(compareIds('ab', 'a')).toBeGreaterThan(0)
    expect(compareIds('013', '013')).toBe(0)
  })
})
