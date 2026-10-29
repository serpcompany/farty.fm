import { describe, expect, it } from 'vitest'
import { coverageSubsets, goldenRecording } from '../test-support/engine-golden'
import { goldenIndex } from '../test-support/golden'
import type { Song } from './catalog/song'
import { songs } from './catalog/songs.generated'
import { fixtureRecordingId } from './fixture-library'
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
  type SongOrder,
  songListing,
  songRows,
  sortRows
} from './pitch-coverage'
import type { AnalysisState, Recording } from './recordings'

const story = ['018', '032', '090', '052', '094', '069', '017', '086', '002', '084', '013', '055']
const lockedByAll = ['jingle', 'row', 'amazing', 'auld']
const fixtureIds = goldenIndex.recordings

function fixtureRecording(id: string, number: number): Recording {
  const golden = goldenRecording(id)
  const rate = goldenIndex.sample_rate
  return {
    id: fixtureRecordingId(id),
    number,
    createdAt: 0,
    seconds: golden.file.frames / golden.file.sample_rate,
    sampleRate: golden.file.sample_rate,
    waveform: [],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: golden.gesture.start_sample / rate,
        gestureEndSeconds: golden.gesture.end_sample / rate,
        cutAtReattack: golden.gesture.cut_at_reattack,
        pitchEstimateMidi: golden.pitch_estimate_midi,
        pitchConfidence: golden.pitch_confidence,
        recordingPitchMidi: golden.melodic ? golden.recording_pitch_midi : null,
        shortestNoteSeconds: golden.melodic ? golden.shortest_note_s : null,
        settleSeconds: golden.melodic ? golden.settle_s : null
      }
    }
  }
}

const fixtures = (ids: readonly string[]) => ids.map((id, i) => fixtureRecording(id, i + 1))
const all = fixtures(fixtureIds)
const takes = (count: number) => fixtures(story.slice(0, count))
const ten = takes(10)

const song = (id: string): Song => {
  const found = songs.find(s => s.id === id)
  if (!found) throw new Error(`No Song ${id}`)
  return found
}

const fixtureId = (recordingId: string | undefined) => recordingId?.slice(-3)

const listing = (recordings: Recording[], query = '', order: SongOrder = 'closestToUnlocking') =>
  songListing(sortRows(songRows(songs, recordings), order), query)

describe('Pitch Coverage against the reference engine', () => {
  it('unlocks 8 of the 12 Songs with the 24 Melodic fixtures', () => {
    expect(all.filter(r => coverageKey([r]) !== '[]')).toHaveLength(24)
    expect(songs).toHaveLength(12)
    for (const s of songs) {
      expect(coverageOf(s, all).unlocked, s.id).toBe(!lockedByAll.includes(s.id))
    }
  })

  it('matches every Song in all 50 subsets of coverage.json', () => {
    expect(coverageSubsets).toHaveLength(50)
    let checked = 0
    for (const subset of coverageSubsets) {
      const recordings = fixtures(subset.recordings)
      for (const want of subset.songs) {
        const catalogSong = songs.find(s => s.id === want.song)
        if (!catalogSong) continue
        const label = `${subset.recordings.join(' ')} / ${want.song}`
        const coverage = coverageOf(catalogSong, recordings)
        expect(coverage.unlocked, label).toBe(want.unlocked)
        expect([coverage.covered, coverage.total], label).toEqual([
          want.pitch_coverage.covered,
          want.pitch_coverage.total
        ])
        expect(coverage.transposition, label).toBe(want.transpose)
        const forPitch = Object.fromEntries(
          catalogSong.pitches.map(p => [
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
    expect(checked).toBe(50 * 12)
  })

  it('unlocks Mary, Ode to Joy and Merry Christmas at the 9th story take, and 7 Songs by the 11th', () => {
    const unlocks: Record<number, string[]> = {}
    const before = new Set<string>()
    for (let take = 1; take <= story.length; take++) {
      const unlocked = songs.filter(s => coverageOf(s, takes(take)).unlocked).map(s => s.id)
      const fresh = unlocked.filter(id => !before.has(id))
      if (fresh.length > 0) unlocks[take] = fresh
      for (const id of unlocked) before.add(id)
    }
    expect(unlocks).toEqual({
      9: ['mary', 'ode', 'merryxmas'],
      10: ['frere'],
      11: ['twinkle', 'birthday', 'saints']
    })
  })

  it('reads the coverage of locked Songs as the reference does', () => {
    const mary = coverageOf(song('mary'), takes(3))
    expect(coverageSummary(mary)).toBe('1 of 4 notes covered')
    expect(mary.transposition).toBe(-28)
    expect(missingNotes(mary)).toBe('G♯2 (1.5 s), A♯2 (0.7 s), and C3 (0.7 s)')
    expect(fixtureId(mary.recordingForPitch.get(74))).toBeUndefined()
    expect(fixtureId(mary.recordingForPitch.get(79))).toBe('032')

    const furelise = coverageOf(song('furelise'), ten)
    expect(coverageSummary(furelise)).toBe('6 of 7 notes covered')
    expect(furelise.transposition).toBe(-16)
    expect(missingNotes(furelise)).toBe('F3 (1.4 s)')
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
  const test = (pitches: number[]): Song => ({
    id: 'test',
    title: 'Test',
    source: '',
    bpm: 60,
    bar_lines: [0],
    length_beats: pitches.length,
    pitches: [...new Set(pitches)].sort((a, b) => a - b),
    notes: pitches.map((pitch, start) => ({ start, dur: 1, pitch }))
  })

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

  it('covers its note like a Melodic Recording: 080 on C2 unlocks 3 Songs the library leaves locked', () => {
    const placed = place(all, '080', C2)
    const { unlocked, locked } = listing(placed)
    expect(unlocked).toHaveLength(11)
    expect(locked.map(r => r.song.id)).toEqual(['amazing'])
    expect(missingNotes(locked[0].coverage)).toBe('C3 (3.0 s)')
    for (const id of ['jingle', 'row', 'auld']) {
      const coverage = coverageOf(song(id), placed)
      expect(coverage.unlocked, id).toBe(true)
      expect([...coverage.recordingForPitch.values()].map(fixtureId), id).toContain('080')
    }
  })

  it('counts for nothing left out, the default, or while the Recording is Melodic', () => {
    expect(coverageKey(place(all, '080', null))).toBe(coverageKey(all))
    expect(coverageKey(place(all, '002', C2))).toBe(coverageKey(all))
    expect(collectedPitchClasses(place(all, '002', 37))).toEqual(collectedPitchClasses(all))
  })

  it('counts only a whole note from C2 to B4, as the picker offers', () => {
    for (const outside of [35, 72, 48.5, Number.NaN]) {
      expect(coverageKey(place(all, '080', outside)), String(outside)).toBe(coverageKey(all))
    }
    expect(coverageKey(place(all, '080', 71))).not.toBe(coverageKey(all))
  })

  it('matches the catalog again when the fart is placed, moved or taken off', () => {
    const keys = [null, C2, C2 + 1, null].map(p => coverageKey(place(all, '080', p)))
    expect(new Set(keys).size).toBe(3)
    expect(keys[3]).toBe(keys[0])
  })

  it('collects the pitch class it is placed on', () => {
    expect(collectedPitchClasses(place(fixtures(['080']), '080', 37))).toEqual(new Set([1]))
    expect(collectedPitchClasses(fixtures(['080']))).toEqual(new Set())
  })

  it('shows no unlock for a Noise-like save until it is placed', () => {
    const before = all.filter(r => fixtureId(r.id) !== '080')
    const left = coverageChanges(songs, before, all)
    expect(left.unlocked).toEqual([])
    const placed = coverageChanges(songs, before, place(all, '080', C2))
    expect(placed.unlocked.map(s => s.id)).toEqual(['jingle', 'row', 'auld'])
  })
})

function pitchClassOf(r: Recording): number[] {
  if (r.analysis.state !== 'analyzed' || r.analysis.analysis.recordingPitchMidi === null) return []
  return [Math.floor(r.analysis.analysis.recordingPitchMidi + 0.5) % 12]
}

describe('Compose’s listing', () => {
  it('puts the highest coverage first, then fewer notes', () => {
    const { unlocked, locked } = listing(ten)
    expect(unlocked.map(r => r.song.id)).toEqual(['mary', 'ode', 'frere', 'merryxmas'])
    expect(locked.map(r => r.song.id)).toEqual([
      'birthday',
      'furelise',
      'auld',
      'twinkle',
      'row',
      'jingle',
      'saints',
      'amazing'
    ])
  })

  it('sorts A–Z within each section', () => {
    const { unlocked, locked } = listing(ten, '', 'alphabetical')
    expect(unlocked.map(r => r.song.title)).toEqual([
      'Frère Jacques',
      'Mary Had a Little Lamb',
      'Ode to Joy',
      'We Wish You a Merry Christmas'
    ])
    expect(locked.map(r => r.song.title)).toEqual([
      'Amazing Grace',
      'Auld Lang Syne',
      'Für Elise',
      'Happy Birthday',
      'Jingle Bells',
      'Row, Row, Row Your Boat',
      'Twinkle, Twinkle, Little Star',
      'When the Saints Go Marching In'
    ])
  })

  it('searches anywhere in the title, ignoring case and accents', () => {
    const ids = (rows: { song: Song }[]) => rows.map(r => r.song.id)
    expect(ids(listing(ten, 'JINGLE').locked)).toEqual(['jingle'])
    expect(ids(listing(ten, 'fur').locked)).toEqual(['furelise'])
    expect(ids(listing(ten, 'frere').unlocked)).toEqual(['frere'])
    expect(ids(listing(ten, 'little').unlocked)).toEqual(['mary'])
    expect(ids(listing(ten, 'little').locked)).toEqual(['twinkle'])
    expect(listing(ten, '  ').unlocked).toHaveLength(4)
    const none = listing(ten, 'zzz')
    expect(none.unlocked.length + none.locked.length).toBe(0)
  })

  it('unlocks 8 Songs with the whole Fixture Library', () => {
    const { unlocked, locked } = listing(all)
    expect(unlocked).toHaveLength(8)
    expect(locked.map(r => r.song.id)).toEqual(['auld', 'row', 'jingle', 'amazing'])
    expect(missingNotes(locked[0].coverage)).toBe('G3 (1.8 s)')
    expect(missingNotes(locked[3].coverage)).toBe('D3 (1.2 s) and F3 (3.0 s)')
  })

  it('locks every Song, fewest notes first, without Melodic Recordings', () => {
    const { unlocked, locked } = listing(fixtures(['018']))
    expect(unlocked).toHaveLength(0)
    expect(locked).toHaveLength(12)
    expect(locked[0].song.id).toBe('mary')
    for (const r of locked) {
      expect(r.coverage.hasMelodicRecordings).toBe(false)
      expect(missingNotes(r.coverage)).toBeNull()
    }
  })

  it('scales to hundreds of Songs', () => {
    const catalog = Array.from({ length: 500 }, (_, i) => {
      const s = songs[i % songs.length]
      return { ...s, id: `${s.id}-${i}`, title: `${s.title} ${i}` }
    })
    const started = performance.now()
    const { unlocked, locked } = songListing(
      sortRows(songRows(catalog, ten), 'closestToUnlocking'),
      ''
    )
    const ms = performance.now() - started
    expect(unlocked.length + locked.length).toBe(500)
    expect(unlocked).toHaveLength(167)
    expect(ms).toBeLessThan(10_000)
  })

  it('names the missing notes with their octave and length', () => {
    expect(missingNotes(coverageOf(song('furelise'), ten))).toBe('F3 (1.4 s)')
    expect(missingNotes(coverageOf(song('jingle'), ten))).toBe('A2 (2.0 s)')
    expect(missingNotes(coverageOf(song('mary'), ten))).toBeNull()
    const few = takes(3)
    expect(missingNotes(coverageOf(song('birthday'), few))).toBe(
      'G♯2 (0.5 s), A♯2 (0.5 s), C3 (1.0 s), C♯3 (1.5 s), F3 (0.5 s), and F♯3 (0.4 s)'
    )
    expect(missingNotes(coverageOf(song('birthday'), few), 3)).toBe(
      'G♯2 (0.5 s), A♯2 (0.5 s), C3 (1.0 s), and 3 more'
    )
    expect(missingNotes(coverageOf(song('mary'), few), 3)).toBe(
      'G♯2 (1.5 s), A♯2 (0.7 s), and C3 (0.7 s)'
    )
  })

  it('matches the catalog again only when the Melodic Recordings change', () => {
    const eight = takes(8)
    const noise = fixtures(['055'])
    expect(coverageKey([...eight, ...noise])).toBe(coverageKey(eight))
    expect(coverageKey(takes(9))).not.toBe(coverageKey(eight))
    const analyzing: Recording = { ...takes(9)[8], analysis: { state: 'analyzing' } }
    expect(coverageKey([...eight, analyzing])).toBe(coverageKey(eight))
    expect(listing(eight).unlocked).toEqual([])
    expect(listing(takes(9)).unlocked.map(r => r.song.id)).toEqual(['mary', 'ode', 'merryxmas'])
    const [first, second, ...rest] = eight
    if (second.analysis.state !== 'analyzed') throw new Error('The 2nd take is analyzed')
    const { settleSeconds, ...stored } = second.analysis.analysis
    expect(settleSeconds).toBeGreaterThan(0)
    const unknown: Recording = { ...second, analysis: { state: 'analyzed', analysis: stored } }
    expect(coverageKey([first, unknown, ...rest])).not.toBe(coverageKey(eight))
  })
})

describe('what a save changed', () => {
  it('lists the unlocks, then the improvements closest first', () => {
    const changes = coverageChanges(songs, takes(8), takes(9))
    expect(changes.unlocked.map(s => s.id)).toEqual(['mary', 'ode', 'merryxmas'])
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
    expect(coverageChanges(songs, all, all).closest?.song.id).toBe('auld')
    const others = songs.filter(s => !lockedByAll.includes(s.id))
    expect(coverageChanges(others, all, all).closest).toBeNull()
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

  it('unlocks a locked Song once a fart near each missing note shows the length it needs', () => {
    const amazing = song('amazing')
    const { missing } = coverageOf(amazing, all)
    expect(missingNotes(coverageOf(amazing, all))).toBe('D3 (1.2 s) and F3 (3.0 s)')
    const near = (lengths: number[]) => missing.map((m, i) => take(100 + i, m.midi - 3, lengths[i]))
    const asNeeded = near(missing.map(m => m.seconds))
    expect(asNeeded.map(formattedFartLength)).toEqual(['1.2 s', '3.0 s'])
    expect(coverageOf(amazing, [...all, ...asNeeded]).unlocked).toBe(true)
    const tooShort = near([1.2, 2.96])
    expect(tooShort.map(formattedFartLength)).toEqual(['1.2 s', '2.9 s'])
    expect(coverageOf(amazing, [...all, ...tooShort]).unlocked).toBe(false)
  })
})
