import { describe, expect, it } from 'vitest'
import { songs } from '@/test-support/songs.generated'
import { coverageSubsets, libraries } from '../test-support/engine-golden'
import {
  allFixtures,
  catalogSong,
  fixtureId,
  fixtures,
  iPhoneListing,
  iPhoneSongs,
  story,
  takes,
  unlockedByAll,
  without002
} from '../test-support/fixture-recordings'
import type { Song } from './catalog/song'
import {
  collectedPitchClasses,
  coverageChanges,
  coverageFraction,
  coverageKey,
  coverageOf,
  coverageSummary,
  fartSeconds,
  formattedFartLength,
  missingNotes,
  songRows
} from './pitch-coverage'
import { type AnalysisState, NO_NOTE, type Recording } from './recordings'

const ten = takes(10)

describe('Pitch Coverage against the reference engine', () => {
  it('unlocks the Songs the reference does with the 26 Melodic fixtures, the iPhone’s 12 too', () => {
    expect(allFixtures.filter(r => coverageKey([r]) !== '[]')).toHaveLength(26)
    expect(iPhoneSongs.map(s => s.id)).toEqual([
      'twinkle',
      'mary',
      'jingle',
      'birthday',
      'frere',
      'saints',
      'row',
      'ode',
      'merryxmas',
      'amazing',
      'furelise',
      'auld'
    ])
    for (const s of songs) {
      expect(coverageOf(s, allFixtures).unlocked, s.id).toBe(unlockedByAll(s))
    }
    expect(iPhoneSongs.every(unlockedByAll)).toBe(true)
  })

  it('matches every Song in all 50 subsets of coverage.json', () => {
    expect(coverageSubsets).toHaveLength(50)
    let checked = 0
    for (const subset of coverageSubsets) {
      const recordings = fixtures(subset.recordings)
      for (const want of subset.songs) {
        const inCatalog = songs.find(s => s.id === want.song)
        if (!inCatalog) continue
        const label = `${subset.recordings.join(' ')} / ${want.song}`
        const coverage = coverageOf(inCatalog, recordings)
        expect(coverage.unlocked, label).toBe(want.unlocked)
        expect([coverage.covered, coverage.total], label).toEqual([
          want.pitch_coverage.covered,
          want.pitch_coverage.total
        ])
        expect(coverage.transposition, label).toBe(want.transpose)
        const forPitch = Object.fromEntries(
          inCatalog.pitches.map(p => [
            String(p),
            fixtureId(coverage.recordingForPitch.get(p)) ?? null
          ])
        )
        expect(forPitch, label).toEqual(want.recording_for_pitch)
        const hasMelodic = recordings.some(r => coverageKey([r]) !== '[]')
        const missing = want.missing.map(m => ({ midi: m.target_midi, seconds: m.seconds }))
        expect(coverage.missing, label).toEqual(hasMelodic ? missing : [])
        checked++
      }
    }
    expect(checked).toBe(50 * songs.length)
  })

  it('unlocks 6 of the iPhone’s Songs at the 9th story take, and 11 by the 11th', () => {
    const unlocks: Record<number, string[]> = {}
    const before = new Set<string>()
    for (let take = 1; take <= story.length; take++) {
      const unlocked = iPhoneSongs.filter(s => coverageOf(s, takes(take)).unlocked).map(s => s.id)
      const fresh = unlocked.filter(id => !before.has(id))
      if (fresh.length > 0) unlocks[take] = fresh
      for (const id of unlocked) before.add(id)
    }
    expect(unlocks).toEqual({
      9: ['mary', 'jingle', 'saints', 'row', 'ode', 'merryxmas'],
      10: ['twinkle', 'frere', 'furelise'],
      11: ['birthday', 'auld']
    })
  })

  it('reads the coverage of locked Songs as the reference does', () => {
    const mary = coverageOf(catalogSong('mary'), takes(3))
    expect(coverageSummary(mary)).toBe('1 of 4 notes covered')
    expect(mary.transposition).toBe(-28)
    expect(missingNotes(mary)).toBe('G♯2 (1.5 s), A♯2 (0.7 s), and C3 (0.7 s)')
    expect(fixtureId(mary.recordingForPitch.get(74))).toBeUndefined()
    expect(fixtureId(mary.recordingForPitch.get(79))).toBe('032')

    const auld = coverageOf(catalogSong('auld'), ten)
    expect(coverageSummary(auld)).toBe('6 of 7 notes covered')
    expect(auld.transposition).toBe(-20)
    expect(missingNotes(auld)).toBe('A2 (1.8 s)')
  })

  it('reads Mary on 095 alone as the compose journey expects (#288)', () => {
    const mary = coverageOf(catalogSong('mary'), fixtures(['095']))
    expect(coverageSummary(mary)).toBe('1 of 4 notes covered')
    expect(mary.transposition).toBe(-36)
    expect(missingNotes(mary)).toBe('C2 (1.5 s), D2 (0.7 s), and E2 (0.7 s)')
    expect(missingNotes(mary, 2)).toBe('C2 (1.5 s), D2 (0.7 s), and 1 more')
  })
})

describe('the Pitch Coverage rule', () => {
  let next = 0
  const melodic = (pitch: number): Recording => recording(pitch, 0.12)
  const recording = (
    pitch: number | null,
    shortest: number | null,
    state: AnalysisState['state'] = 'analyzed'
  ): Recording => ({
    id: `test-${String(next++).padStart(3, '0')}`,
    number: next,
    createdAt: 0,
    seconds: 1,
    sampleRate: 44100,
    waveform: [],
    analysis:
      state === 'analyzed'
        ? {
            state,
            analysis: {
              gestureStartSeconds: 0,
              gestureEndSeconds: 1,
              cutAtReattack: false,
              pitchEstimateMidi: pitch,
              pitchConfidence: 1,
              recordingPitchMidi: pitch,
              shortestNoteSeconds: shortest
            }
          }
        : { state }
  })
  const test = (pitches: number[]): Song => {
    const distinct = [...new Set(pitches)].sort((a, b) => a - b)
    return {
      id: 'test',
      title: 'Test',
      source: '',
      bpm: 60,
      bar_lines: [0],
      length_beats: pitches.length,
      pitches: distinct,
      durations: distinct.map(p => pitches.filter(q => q === p).map(() => 1)),
      notesPath: '/catalog/notes/test.json',
      notes: pitches.map((pitch, start) => ({ start, dur: 1, pitch }))
    }
  }

  it('gives each pitch its own Recording', () => {
    const one = coverageOf(test([60, 62]), [melodic(61)])
    expect([one.covered, one.total, one.unlocked]).toEqual([1, 2, false])
    const two = coverageOf(test([60, 62]), [melodic(61), melodic(61.2)])
    expect(two.unlocked).toBe(true)
    expect(new Set(two.recordingForPitch.values()).size).toBe(2)
  })

  it('moves a Recording at most 3 semitones, or an octave with an Octave Move', () => {
    expect(coverageOf(test([60, 67]), [melodic(60), melodic(70.5)]).unlocked).toBe(true)
    expect(coverageOf(test([60, 67]), [melodic(60), melodic(79)]).unlocked).toBe(true)
    const far = coverageOf(test([60, 67]), [melodic(60), melodic(100)])
    expect(far.covered).toBe(1)
    expect(far.missing).toHaveLength(1)
  })

  it('covers nothing without Melodic Recordings', () => {
    const coverage = coverageOf(songs[0], [])
    expect(coverage.hasMelodicRecordings).toBe(false)
    expect(coverage.unlocked).toBe(false)
    expect(coverageSummary(coverage)).toBe('0 of 6 notes covered')
    expect(missingNotes(coverage)).toBeNull()
    expect(coverageFraction(coverage)).toBe(0)
  })

  it('ignores Noise-like and unanalyzed Recordings', () => {
    const note = melodic(60)
    const recordings = [
      recording(null, null),
      recording(null, null, 'analyzing'),
      recording(null, null, 'notAnalyzed'),
      note
    ]
    const coverage = coverageOf(test([72]), recordings)
    expect(coverage.unlocked).toBe(true)
    expect(coverageSummary(coverage)).toBe('All 1 notes covered')
    expect([...coverage.recordingForPitch]).toEqual([[72, note.id]])
  })

  it('collects the pitch class of every Melodic Recording', () => {
    expect([...collectedPitchClasses(ten)].sort((a, b) => a - b)).toEqual(
      [...new Set(ten.flatMap(r => pitchClassOf(r)))].sort((a, b) => a - b)
    )
    expect(collectedPitchClasses([melodic(55.83), melodic(67.43), recording(null, null)])).toEqual(
      new Set([8, 7])
    )
  })
})

describe('Placed Recordings (ADR 0015)', () => {
  const C2 = 36
  const place = (recordings: Recording[], fixture: string, placed: number | null) =>
    recordings.map(r => (fixtureId(r.id) === fixture ? { ...r, placedPitch: placed } : r))
  const small = fixtures(libraries.small)
  const with065 = fixtures([...libraries.small, '065'])

  it('covers its note like a Melodic Recording: 065 on C2 unlocks 5 Songs the small library leaves locked', () => {
    expect(iPhoneListing(with065).unlocked.map(r => r.song.id)).toEqual(['mary', 'saints'])
    const placed = place(with065, '065', C2)
    const { unlocked, locked } = iPhoneListing(placed)
    expect(unlocked).toHaveLength(7)
    expect(locked.map(r => r.song.id)).toContain('amazing')
    for (const id of ['jingle', 'row']) {
      const coverage = coverageOf(catalogSong(id), placed)
      expect(coverage.unlocked, id).toBe(true)
      expect([...coverage.recordingForPitch.values()].map(fixtureId), id).toContain('065')
    }
  })

  it('counts for nothing left out, the default', () => {
    expect(coverageKey(place(allFixtures, '065', null))).toBe(coverageKey(allFixtures))
  })

  it('stays in use when a new analysis finds the Recording Melodic (ADR 0017)', () => {
    expect(collectedPitchClasses(fixtures(['009']))).toEqual(new Set([7]))
    expect(collectedPitchClasses(place(fixtures(['009']), '009', 37))).toEqual(new Set([1]))
    expect(coverageKey(place(allFixtures, '009', C2))).not.toBe(coverageKey(allFixtures))
    expect(coverageKey(place(allFixtures, '009', null))).toBe(coverageKey(allFixtures))
  })

  it('counts only a whole note from C2 to B4, as the review offers', () => {
    for (const outside of [35, 72, 48.5, Number.NaN]) {
      expect(coverageKey(place(allFixtures, '065', outside)), String(outside)).toBe(
        coverageKey(allFixtures)
      )
    }
    expect(coverageKey(place(allFixtures, '065', 71))).not.toBe(coverageKey(allFixtures))
  })

  it('matches the catalog again when the fart is placed, moved or taken off', () => {
    const keys = [null, C2, C2 + 1, null].map(p => coverageKey(place(allFixtures, '065', p)))
    expect(new Set(keys).size).toBe(3)
    expect(keys[3]).toBe(keys[0])
  })

  it('collects the pitch class it is placed on', () => {
    expect(collectedPitchClasses(place(fixtures(['065']), '065', 37))).toEqual(new Set([1]))
    expect(collectedPitchClasses(fixtures(['065']))).toEqual(new Set())
  })

  it('leaves a Melodic Recording out with "No note": 002 out locks Amazing Grace (#314)', () => {
    const left = place(allFixtures, '002', NO_NOTE)
    expect(coverageKey(left)).toBe(coverageKey(without002))
    expect(iPhoneListing(left).locked.map(r => r.song.id)).toEqual(['amazing'])
    expect(coverageKey(place(allFixtures, '002', null))).toBe(coverageKey(allFixtures))
  })

  it('shows no unlock for a Noise-like save until it is placed', () => {
    expect(coverageChanges(songs, small, with065).unlocked).toEqual([])
    const placed = coverageChanges(iPhoneSongs, small, place(with065, '065', C2))
    expect(placed.unlocked.map(s => s.id)).toEqual([
      'jingle',
      'row',
      'ode',
      'merryxmas',
      'furelise'
    ])
  })
})

function pitchClassOf(r: Recording): number[] {
  if (r.analysis.state !== 'analyzed' || r.analysis.analysis.recordingPitchMidi === null) return []
  return [Math.floor(r.analysis.analysis.recordingPitchMidi + 0.5) % 12]
}

describe('what a save changed', () => {
  it('lists the unlocks, then the improvements closest first', () => {
    const changes = coverageChanges(iPhoneSongs, takes(8), takes(9))
    expect(changes.unlocked.map(s => s.id)).toEqual([
      'mary',
      'jingle',
      'saints',
      'row',
      'ode',
      'merryxmas'
    ])
    expect(changes.improved.every(r => !r.coverage.unlocked)).toBe(true)
    const fractions = changes.improved.map(r => coverageFraction(r.coverage))
    expect(fractions).toEqual([...fractions].sort((a, b) => b - a))
    expect(changes.closest?.coverage.unlocked).toBe(false)
  })

  it('shows no unlock for a Noise-like save, and the Song closest to unlocking', () => {
    const changes = coverageChanges(songs, takes(4), [...takes(4), ...fixtures(['055'])])
    expect(changes.unlocked).toEqual([])
    expect(changes.improved).toEqual([])
    const locked = songRows(songs, takes(4)).filter(r => !r.coverage.unlocked)
    const best = Math.max(...locked.map(r => coverageFraction(r.coverage)))
    const closest = locked.find(r => coverageFraction(r.coverage) === best)
    expect(changes.closest?.song.id).toBe(closest?.song.id)
  })

  it('has no Song closest to unlocking once every Song is unlocked', () => {
    expect(coverageChanges(iPhoneSongs, without002, without002).closest?.song.id).toBe('amazing')
    expect(coverageChanges(iPhoneSongs, allFixtures, allFixtures).closest).toBeNull()
  })
})

describe('the fart length a Recording shows (#227)', () => {
  const take = (number: number, midi: number, fart: number): Recording => ({
    id: `take-${number}`,
    number,
    createdAt: 0,
    seconds: fart + 1,
    sampleRate: 44_100,
    waveform: [],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: 0.5,
        gestureEndSeconds: 0.5 + fart,
        cutAtReattack: false,
        pitchEstimateMidi: midi,
        pitchConfidence: 1,
        recordingPitchMidi: midi,
        shortestNoteSeconds: 0.1,
        settleSeconds: 0
      }
    }
  })

  it('is the fart, not the whole take', () => {
    const recording = take(1, 60, 2.4)
    expect(fartSeconds(recording)).toBeCloseTo(2.4, 9)
    expect(formattedFartLength(recording)).toBe('2.4 s')
    expect(formattedFartLength({ ...recording, analysis: { state: 'analyzing' } })).toBe('3.4 s')
  })

  it('is its Trim’s fart once trimmed, Melodic or not (#314)', () => {
    const fart = { startSeconds: 0.6, endSeconds: 1.8 }
    const trimmed = { ...take(1, 60, 2.4), trim: { startSeconds: 0.55, endSeconds: 1.9, fart } }
    expect(formattedFartLength(trimmed)).toBe('1.2 s')
    expect(coverageKey([trimmed])).not.toBe(coverageKey([take(1, 60, 2.4)]))
  })

  it('unlocks a locked Song once a fart near each missing note shows the length it needs', () => {
    const amazing = catalogSong('amazing')
    const { missing } = coverageOf(amazing, without002)
    expect(missingNotes(coverageOf(amazing, without002))).toBe('E3 (3.0 s)')
    const near = (lengths: number[]) => missing.map((m, i) => take(100 + i, m.midi - 3, lengths[i]))
    const asNeeded = near(missing.map(m => m.seconds))
    expect(asNeeded.map(formattedFartLength)).toEqual(['3.0 s'])
    expect(coverageOf(amazing, [...without002, ...asNeeded]).unlocked).toBe(true)
    const tooShort = near([2.96])
    expect(tooShort.map(formattedFartLength)).toEqual(['2.9 s'])
    expect(coverageOf(amazing, [...without002, ...tooShort]).unlocked).toBe(false)
  })
})
