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
 */
const story = ['018', '032', '090', '052', '094', '059', '019', '086', '017', '084', '013', '055']
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
const takes = (count: number) => fixtures(story.slice(0, count))
const eight = takes(8)

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
  it('unlocks all 12 Songs with the 24 Melodic fixtures', () => {
    expect(all.filter(r => coverageKey([r]) !== '[]')).toHaveLength(24)
    expect(songs).toHaveLength(12)
    for (const s of songs) expect(coverageOf(s, all).unlocked, s.id).toBe(true)
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
        const missing = Object.entries(want.recording_for_pitch)
          .filter(([, recording]) => recording === null)
          .map(([pitch]) => Number(pitch) + want.transpose)
          .sort((a, b) => a - b)
        expect(coverage.missing, label).toEqual(hasMelodic ? missing : [])
        checked++
      }
    }
    expect(checked).toBe(50 * 12)
  })

  it('unlocks Mary at the 6th story take, and every Song by the 10th', () => {
    const unlocks: Record<number, string[]> = {}
    const before = new Set<string>()
    for (let take = 1; take <= story.length; take++) {
      const unlocked = songs.filter(s => coverageOf(s, takes(take)).unlocked).map(s => s.id)
      const fresh = unlocked.filter(id => !before.has(id))
      if (fresh.length > 0) unlocks[take] = fresh
      for (const id of unlocked) before.add(id)
    }
    expect(unlocks).toEqual({
      6: ['mary'],
      7: ['jingle', 'saints', 'ode'],
      8: ['twinkle', 'row', 'amazing'],
      9: ['frere', 'furelise', 'auld'],
      10: ['birthday', 'merryxmas']
    })
  })

  it('reads the coverage of locked Songs as the reference does', () => {
    const mary = coverageOf(song('mary'), takes(3))
    expect(coverageSummary(mary)).toBe('2 of 4 notes covered')
    expect(mary.transposition).toBe(-21)
    expect(missingNotes(mary)).toBe('F3 and A♯3')
    expect(fixtureId(mary.recordingForPitch.get(72))).toBe('032')
    expect(fixtureId(mary.recordingForPitch.get(76))).toBe('090')

    const birthday = coverageOf(song('birthday'), eight)
    expect(coverageSummary(birthday)).toBe('6 of 8 notes covered')
    expect(birthday.transposition).toBe(-16)
    expect(missingNotes(birthday)).toBe('C3 and D♯3')
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
    beats_per_bar: 4,
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
    expect([...collectedPitchClasses(eight)].sort((a, b) => a - b)).toEqual(
      [...new Set(eight.flatMap(r => pitchClassOf(r)))].sort((a, b) => a - b)
    )
    expect(collectedPitchClasses([melodic(55.83), melodic(67.43), recording(null, null)])).toEqual(
      new Set([8, 7])
    )
  })
})

function pitchClassOf(r: Recording): number[] {
  if (r.analysis.state !== 'analyzed' || r.analysis.analysis.recordingPitchMidi === null) return []
  return [Math.floor(r.analysis.analysis.recordingPitchMidi + 0.5) % 12]
}

describe('Compose’s listing', () => {
  it('puts the highest coverage first, then fewer notes', () => {
    const { unlocked, locked } = listing(eight)
    expect(unlocked.map(r => r.song.id)).toEqual([
      'mary',
      'jingle',
      'saints',
      'ode',
      'twinkle',
      'row',
      'amazing'
    ])
    expect(locked.map(r => r.song.id)).toEqual([
      'frere',
      'furelise',
      'auld',
      'birthday',
      'merryxmas'
    ])
  })

  it('sorts A–Z within each section', () => {
    const { unlocked, locked } = listing(eight, '', 'alphabetical')
    expect(unlocked.map(r => r.song.title)).toEqual([
      'Amazing Grace',
      'Jingle Bells',
      'Mary Had a Little Lamb',
      'Ode to Joy',
      'Row, Row, Row Your Boat',
      'Twinkle, Twinkle, Little Star',
      'When the Saints Go Marching In'
    ])
    expect(locked.map(r => r.song.title)).toEqual([
      'Auld Lang Syne',
      'Frère Jacques',
      'Für Elise',
      'Happy Birthday',
      'We Wish You a Merry Christmas'
    ])
  })

  it('searches anywhere in the title, ignoring case and accents', () => {
    const ids = (rows: { song: Song }[]) => rows.map(r => r.song.id)
    expect(ids(listing(eight, 'JINGLE').unlocked)).toEqual(['jingle'])
    expect(ids(listing(eight, 'fur').locked)).toEqual(['furelise'])
    expect(ids(listing(eight, 'frere').locked)).toEqual(['frere'])
    expect(ids(listing(eight, 'little').unlocked)).toEqual(['mary', 'twinkle'])
    expect(listing(eight, '  ').unlocked).toHaveLength(7)
    const none = listing(eight, 'zzz')
    expect(none.unlocked.length + none.locked.length).toBe(0)
  })

  it('unlocks every Song with the whole Fixture Library', () => {
    const { unlocked, locked } = listing(all)
    expect(unlocked).toHaveLength(12)
    expect(locked).toHaveLength(0)
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
      sortRows(songRows(catalog, eight), 'closestToUnlocking'),
      ''
    )
    const ms = performance.now() - started
    expect(unlocked.length + locked.length).toBe(500)
    // 41 rounds of 7 Unlocked Songs, then 6 of the next 8 Songs.
    expect(unlocked).toHaveLength(293)
    expect(ms).toBeLessThan(10_000)
  })

  // The reference's `melody_fit().missing` on the same takes. The settle cost (#116) moved the
  // cheapest transposition of locked `frere` and `birthday`, and the contour that keeps the attack
  // (#208) moved `birthday`'s again.
  it('names the missing notes with their octave', () => {
    expect(missingNotes(coverageOf(song('birthday'), eight))).toBe('C3 and D♯3')
    expect(missingNotes(coverageOf(song('frere'), eight))).toBe('C♯3')
    expect(missingNotes(coverageOf(song('mary'), eight))).toBeNull()
    const few = takes(3)
    expect(missingNotes(coverageOf(song('birthday'), few))).toBe('G♯2, A♯2, C3, C♯3, F3, and G♯3')
    expect(missingNotes(coverageOf(song('birthday'), few), 3)).toBe('G♯2, A♯2, C3, and 3 more')
    expect(missingNotes(coverageOf(song('mary'), few), 3)).toBe('F3 and A♯3')
  })

  it('matches the catalog again only when the Melodic Recordings change', () => {
    const five = takes(5)
    const noise = fixtures(['055'])
    // A Noise-like Recording (055) changes nothing; the 6th take, a Melodic one, does.
    expect(coverageKey([...five, ...noise])).toBe(coverageKey(five))
    expect(coverageKey(takes(6))).not.toBe(coverageKey(five))
    const analyzing: Recording = { ...takes(6)[5], analysis: { state: 'analyzing' } }
    expect(coverageKey([...five, analyzing])).toBe(coverageKey(five))
    expect(listing(takes(6)).unlocked.map(r => r.song.id)).toEqual(['mary'])
    // So does a settle time added on load to an analysis stored before #116: it moves Auto-map.
    // The 2nd take, 032, is Melodic and settles in 0.128 s.
    const [first, second, ...rest] = five
    if (second.analysis.state !== 'analyzed') throw new Error('The 2nd take is analyzed')
    const { settleSeconds, ...stored } = second.analysis.analysis
    expect(settleSeconds).toBeGreaterThan(0)
    const unknown: Recording = { ...second, analysis: { state: 'analyzed', analysis: stored } }
    expect(coverageKey([first, unknown, ...rest])).not.toBe(coverageKey(five))
  })
})

describe('what a save changed', () => {
  it('lists the unlocks, then the improvements closest first', () => {
    const changes = coverageChanges(songs, takes(6), takes(7))
    expect(changes.unlocked.map(s => s.id)).toEqual(['jingle', 'saints', 'ode'])
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
    expect(coverageChanges(songs, all, all).closest).toBeNull()
  })
})
