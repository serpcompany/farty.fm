import { describe, expect, it } from 'vitest'
import { coverageSubsets, goldenRecording, libraries } from '../test-support/engine-golden'
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

// Pitch Coverage as the app reads it, checked against the reference engine's golden data and
// ported from the iPhone app's `PitchCoverageTests` and `SongListingTests`.

/**
 * The sample story's takes, in order: Melodic ones that unlock Songs, with 3 Noise-like takes
 * (018, 052, 055). The iPhone's story starts with 069 and ends with 002, which #208 made Melodic.
 * Since ADR 0011 a Recording has to be as long as the notes it plays, at its own length since ADR
 * 0012, so the short takes (086 is 0.24 s) unlock nothing on their own. The first Songs unlock at
 * the 9th take, 002, the longest fixture (4.04 s, every burst since ADR 0016).
 */
const story = ['018', '032', '090', '052', '094', '069', '017', '086', '002', '084', '013', '055']
const fixtureIds = goldenIndex.recordings

/** A Recording of this fixture with the reference engine's analysis and its Fixture Library id. */
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
/**
 * The Fixture Library without 002, which alone lasts 3 s: it leaves Amazing Grace locked.
 */
const without002 = all.filter(r => r.id !== fixtureRecordingId('002'))
const takes = (count: number) => fixtures(story.slice(0, count))
const ten = takes(10)

const song = (id: string): Song => {
  const found = songs.find(s => s.id === id)
  if (!found) throw new Error(`No Song ${id}`)
  return found
}

/** The fixture id of a Fixture Library Recording id. */
const fixtureId = (recordingId: string | undefined) => recordingId?.slice(-3)

const listing = (recordings: Recording[], query = '', order: SongOrder = 'closestToUnlocking') =>
  songListing(sortRows(songRows(songs, recordings), order), query)

describe('Pitch Coverage against the reference engine', () => {
  it('unlocks all 12 Songs with the 26 Melodic fixtures', () => {
    expect(all.filter(r => coverageKey([r]) !== '[]')).toHaveLength(26)
    expect(songs).toHaveLength(12)
    // Each fart plays at its own length (ADR 0012), every burst of it (ADR 0016).
    for (const s of songs) {
      expect(coverageOf(s, all).unlocked, s.id).toBe(true)
    }
  })

  it('matches every Song in all 50 subsets of coverage.json', () => {
    expect(coverageSubsets).toHaveLength(50)
    let checked = 0
    for (const subset of coverageSubsets) {
      const recordings = fixtures(subset.recordings)
      for (const want of subset.songs) {
        const catalogSong = songs.find(s => s.id === want.song)
        // `ode-mutopia` is a second import of Ode to Joy that the app doesn't ship.
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

  it('unlocks 6 Songs at the 9th story take, and 11 by the 11th', () => {
    const unlocks: Record<number, string[]> = {}
    const before = new Set<string>()
    for (let take = 1; take <= story.length; take++) {
      const unlocked = songs.filter(s => coverageOf(s, takes(take)).unlocked).map(s => s.id)
      const fresh = unlocked.filter(id => !before.has(id))
      if (fresh.length > 0) unlocks[take] = fresh
      for (const id of unlocked) before.add(id)
    }
    // Amazing Grace still needs a 3 s fart near A♯3.
    expect(unlocks).toEqual({
      9: ['mary', 'jingle', 'saints', 'row', 'ode', 'merryxmas'],
      10: ['twinkle', 'frere', 'furelise'],
      // Happy Birthday's score holds its last "you" 3 beats, 1.5 s (#232).
      11: ['birthday', 'auld']
    })
  })

  it('reads the coverage of locked Songs as the reference does', () => {
    // 090 (0.48 s) is too short for any of Mary's notes, played at its own length.
    const mary = coverageOf(song('mary'), takes(3))
    expect(coverageSummary(mary)).toBe('1 of 4 notes covered')
    expect(mary.transposition).toBe(-28)
    expect(missingNotes(mary)).toBe('G♯2 (1.5 s), A♯2 (0.7 s), and C3 (0.7 s)')
    expect(fixtureId(mary.recordingForPitch.get(74))).toBeUndefined()
    expect(fixtureId(mary.recordingForPitch.get(79))).toBe('032')

    const auld = coverageOf(song('auld'), ten)
    expect(coverageSummary(auld)).toBe('6 of 7 notes covered')
    expect(auld.transposition).toBe(-20)
    expect(missingNotes(auld)).toBe('A2 (1.8 s)')
  })
})

describe('the Pitch Coverage rule', () => {
  let next = 0
  /** A Melodic Recording at `pitch` that holds notes of 0.12 s and longer. */
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
  /** One beat per pitch, at 60 bpm. */
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
  /** `recordings` with the fixture's Recording given `placedPitch`. */
  const place = (recordings: Recording[], fixture: string, placed: number | null) =>
    recordings.map(r => (fixtureId(r.id) === fixture ? { ...r, placedPitch: placed } : r))
  /** The golden small library, all six Melodic, and 065, Noise-like and 1.49 s long. */
  const small = fixtures(libraries.small)
  const with065 = fixtures([...libraries.small, '065'])

  it('covers its note like a Melodic Recording: 065 on C2 unlocks 5 Songs the small library leaves locked', () => {
    // The same Arrangements as `tools/melody-lab/test_placed.py`.
    expect(listing(with065).unlocked.map(r => r.song.id)).toEqual(['mary', 'saints'])
    const placed = place(with065, '065', C2)
    const { unlocked, locked } = listing(placed)
    expect(unlocked).toHaveLength(7)
    expect(locked.map(r => r.song.id)).toContain('amazing')
    for (const id of ['jingle', 'row']) {
      const coverage = coverageOf(song(id), placed)
      expect(coverage.unlocked, id).toBe(true)
      expect([...coverage.recordingForPitch.values()].map(fixtureId), id).toContain('065')
    }
  })

  it('counts for nothing left out, the default', () => {
    expect(coverageKey(place(all, '065', null))).toBe(coverageKey(all))
  })

  it('stays in use when a new analysis finds the Recording Melodic (ADR 0017)', () => {
    // 009 was Noise-like until the second pitch window found it near G1 (#282).
    expect(collectedPitchClasses(fixtures(['009']))).toEqual(new Set([7]))
    expect(collectedPitchClasses(place(fixtures(['009']), '009', 37))).toEqual(new Set([1]))
    expect(coverageKey(place(all, '009', C2))).not.toBe(coverageKey(all))
    expect(coverageKey(place(all, '009', null))).toBe(coverageKey(all))
  })

  it('counts only a whole note from C2 to B4, as the picker offers', () => {
    for (const outside of [35, 72, 48.5, Number.NaN]) {
      expect(coverageKey(place(all, '065', outside)), String(outside)).toBe(coverageKey(all))
    }
    expect(coverageKey(place(all, '065', 71))).not.toBe(coverageKey(all))
  })

  it('matches the catalog again when the fart is placed, moved or taken off', () => {
    const keys = [null, C2, C2 + 1, null].map(p => coverageKey(place(all, '065', p)))
    expect(new Set(keys).size).toBe(3)
    expect(keys[3]).toBe(keys[0])
  })

  it('collects the pitch class it is placed on', () => {
    expect(collectedPitchClasses(place(fixtures(['065']), '065', 37))).toEqual(new Set([1]))
    expect(collectedPitchClasses(fixtures(['065']))).toEqual(new Set())
  })

  it('shows no unlock for a Noise-like save until it is placed', () => {
    expect(coverageChanges(songs, small, with065).unlocked).toEqual([])
    const placed = coverageChanges(songs, small, place(with065, '065', C2))
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

describe('Compose’s listing', () => {
  it('puts the highest coverage first, then fewer notes', () => {
    const { unlocked, locked } = listing(ten)
    expect(unlocked.map(r => r.song.id)).toEqual([
      'mary',
      'jingle',
      'saints',
      'ode',
      'twinkle',
      'row',
      'frere',
      'merryxmas',
      'furelise'
    ])
    expect(locked.map(r => r.song.id)).toEqual(['birthday', 'auld', 'amazing'])
  })

  it('sorts A–Z within each section', () => {
    const { unlocked, locked } = listing(ten, '', 'alphabetical')
    expect(unlocked.map(r => r.song.title)).toEqual([
      'Frère Jacques',
      'Für Elise',
      'Jingle Bells',
      'Mary Had a Little Lamb',
      'Ode to Joy',
      'Row, Row, Row Your Boat',
      'Twinkle, Twinkle, Little Star',
      'We Wish You a Merry Christmas',
      'When the Saints Go Marching In'
    ])
    expect(locked.map(r => r.song.title)).toEqual([
      'Amazing Grace',
      'Auld Lang Syne',
      'Happy Birthday'
    ])
  })

  it('searches anywhere in the title, ignoring case and accents', () => {
    const ids = (rows: { song: Song }[]) => rows.map(r => r.song.id)
    expect(ids(listing(ten, 'JINGLE').unlocked)).toEqual(['jingle'])
    expect(ids(listing(ten, 'fur').unlocked)).toEqual(['furelise'])
    expect(ids(listing(ten, 'frere').unlocked)).toEqual(['frere'])
    expect(ids(listing(ten, 'little').unlocked)).toEqual(['mary', 'twinkle'])
    expect(ids(listing(ten, 'BIRTH').locked)).toEqual(['birthday'])
    expect(listing(ten, '  ').unlocked).toHaveLength(9)
    const none = listing(ten, 'zzz')
    expect(none.unlocked.length + none.locked.length).toBe(0)
  })

  it('unlocks all 12 Songs with the whole Fixture Library, and 11 without 002', () => {
    expect(listing(all).unlocked).toHaveLength(12)
    expect(listing(all).locked).toEqual([])
    const { unlocked, locked } = listing(without002)
    expect(unlocked).toHaveLength(11)
    expect(locked.map(r => r.song.id)).toEqual(['amazing'])
    expect(locked.map(r => missingNotes(r.coverage))).toEqual(['E3 (3.0 s)'])
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
    // 41 rounds of 9 Unlocked Songs, then 7 of the next 8 Songs.
    expect(unlocked).toHaveLength(376)
    expect(ms).toBeLessThan(10_000)
  })

  // The reference's `melody_fit().missing` on the same takes: each note with the shortest fart
  // that would cover it (ADR 0011).
  it('names the missing notes with their octave and length', () => {
    expect(missingNotes(coverageOf(song('birthday'), ten))).toBe('A2 (0.5 s)')
    expect(missingNotes(coverageOf(song('amazing'), ten))).toBe('A3 (3.0 s)')
    expect(missingNotes(coverageOf(song('mary'), ten))).toBeNull()
    const few = takes(3)
    expect(missingNotes(coverageOf(song('birthday'), few))).toBe(
      'B2 (0.5 s), C♯3 (0.5 s), E3 (1.5 s), F♯3 (0.5 s), A3 (0.4 s), and B3 (0.5 s)'
    )
    expect(missingNotes(coverageOf(song('birthday'), few), 3)).toBe(
      'B2 (0.5 s), C♯3 (0.5 s), E3 (1.5 s), and 3 more'
    )
    expect(missingNotes(coverageOf(song('mary'), few), 3)).toBe(
      'G♯2 (1.5 s), A♯2 (0.7 s), and C3 (0.7 s)'
    )
  })

  it('matches the catalog again only when the Melodic Recordings change', () => {
    const eight = takes(8)
    const noise = fixtures(['055'])
    // A Noise-like Recording (055) changes nothing; the 9th take, a Melodic one, does.
    expect(coverageKey([...eight, ...noise])).toBe(coverageKey(eight))
    expect(coverageKey(takes(9))).not.toBe(coverageKey(eight))
    const analyzing: Recording = { ...takes(9)[8], analysis: { state: 'analyzing' } }
    expect(coverageKey([...eight, analyzing])).toBe(coverageKey(eight))
    expect(listing(eight).unlocked).toEqual([])
    expect(listing(takes(9)).unlocked.map(r => r.song.id)).toEqual([
      'mary',
      'jingle',
      'saints',
      'ode',
      'row',
      'merryxmas'
    ])
    // So does a settle time added on load to an analysis stored before #116: it moves Auto-map.
    // The 2nd take, 032, is Melodic and settles in 0.128 s.
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
    // The first in catalog order of the locked Songs with the highest coverage, as on the iPhone.
    const locked = songRows(songs, takes(4)).filter(r => !r.coverage.unlocked)
    const best = Math.max(...locked.map(r => coverageFraction(r.coverage)))
    const closest = locked.find(r => coverageFraction(r.coverage) === best)
    expect(changes.closest?.song.id).toBe(closest?.song.id)
  })

  it('has no Song closest to unlocking once every Song is unlocked', () => {
    expect(coverageChanges(songs, without002, without002).closest?.song.id).toBe('amazing')
    expect(coverageChanges(songs, all, all).closest).toBeNull()
  })
})

describe('the fart length a Recording shows (#227)', () => {
  /** A Melodic Recording at `midi` whose fart lasts `fart` seconds, in a take 1 s longer. */
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
    // Before analysis has found the fart, the whole take.
    expect(formattedFartLength({ ...recording, analysis: { state: 'analyzing' } })).toBe('3.4 s')
  })

  it('unlocks a locked Song once a fart near each missing note shows the length it needs', () => {
    // Amazing Grace on the Fixture Library without 002. Its E3 needs 3.0 s for a 2.975 s note, so
    // a 2.96 s fart shows 2.9 s: rounded to the nearest, it would show 3.0 s and stay locked.
    const amazing = song('amazing')
    const { missing } = coverageOf(amazing, without002)
    expect(missingNotes(coverageOf(amazing, without002))).toBe('E3 (3.0 s)')
    // Each fart 3 semitones below its note.
    const near = (lengths: number[]) => missing.map((m, i) => take(100 + i, m.midi - 3, lengths[i]))
    const asNeeded = near(missing.map(m => m.seconds))
    expect(asNeeded.map(formattedFartLength)).toEqual(['3.0 s'])
    expect(coverageOf(amazing, [...without002, ...asNeeded]).unlocked).toBe(true)
    const tooShort = near([2.96])
    expect(tooShort.map(formattedFartLength)).toEqual(['2.9 s'])
    expect(coverageOf(amazing, [...without002, ...tooShort]).unlocked).toBe(false)
  })
})
