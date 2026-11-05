import { describe, expect, it } from 'vitest'
import {
  choiceCases,
  coverageSubsets,
  type GoldenChoices,
  goldenArrangement,
  goldenRecording,
  libraries,
  songIds
} from '../test-support/engine-golden'
import { goldenIndex } from '../test-support/golden'
import { goldenAnalysisRecording } from '../test-support/golden-analysis'
import { searchKey } from './catalog/search-key'
import { type KindChoice, type Song, type SongSummary, songKinds } from './catalog/song'
import { songs } from './catalog/songs.generated'
import type { FartChoices } from './engine/fart-choices'
import { fixtureRecordingId } from './fixture-library'
import {
  arrangementOf,
  collectedPitchClasses,
  coverageChanges,
  coverageFraction,
  coverageKey,
  coverageOf,
  coverageSummary,
  fartSeconds,
  formattedFartLength,
  missingNotes,
  orderUnlocked,
  type SongFilters,
  type SongOrder,
  type SongRow,
  songListing,
  songRows,
  sortRows
} from './pitch-coverage'
import { type AnalysisState, NO_NOTE, type Recording } from './recordings'

// Pitch Coverage as the app reads it, checked against the reference engine's golden data and
// ported from the iPhone app's `PitchCoverageTests` and `SongListingTests`. The ported tests read
// the iPhone app's 12 Songs, the first in the app's order; every Song the golden data arranges is
// checked against it (`arranged`), and Compose lists every Song in the catalog (#350).

/**
 * The sample story's takes, in order: Melodic ones that unlock Songs, with 3 Noise-like takes
 * (018, 052, 055). The iPhone's story starts with 069 and ends with 002, which #208 made Melodic.
 * Since ADR 0011 a Recording has to be as long as the notes it plays, at its own length since ADR
 * 0012, so the short takes (086 is 0.24 s) unlock none of the iPhone's Songs on their own. Those
 * first unlock at the 9th take, 002, the longest fixture (4.04 s, every burst since ADR 0016).
 * Shorter Songs from the catalog, such as Hot Cross Buns, unlock sooner.
 */
const story = ['018', '032', '090', '052', '094', '069', '017', '086', '002', '084', '013', '055']
const fixtureIds = goldenIndex.recordings

const fixtures = (ids: readonly string[]) =>
  ids.map((id, i) => goldenAnalysisRecording(goldenRecording(id), i + 1, goldenIndex.sample_rate))
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

/** The iPhone app's Songs, the first in the app's order (#229). */
const iPhone = songs.slice(0, 12)
/**
 * The Songs the reference engine's golden data arranges: the 128 the app shipped before #350.
 * Every later Song passed `tools/catalog/import_pdmx.py`'s render gate on the reference engine.
 */
const arranged = songs.filter(s => songIds.includes(s.id))

const listing = (
  recordings: Recording[],
  query = '',
  order: SongOrder = 'closestToUnlocking',
  filters: SongFilters = {}
) => songListing(sortRows(songRows(songs, recordings), order), query, filters)
/** Compose's listing of the iPhone app's Songs only, as the iPhone's tests read it. */
const iPhoneListing = (recordings: Recording[], order: SongOrder = 'closestToUnlocking') =>
  songListing(sortRows(songRows(iPhone, recordings), order), '')
/** Whether the whole Fixture Library unlocks the Song, as the reference engine says. */
const unlockedByAll = (s: SongSummary) => goldenArrangement('full', s.id).unlocked

describe('Pitch Coverage against the reference engine', () => {
  it('unlocks the Songs the reference does with the 26 Melodic fixtures, the iPhone’s 12 too', () => {
    expect(all.filter(r => coverageKey([r]) !== '[]')).toHaveLength(26)
    expect(iPhone.map(s => s.id)).toEqual([
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
    // Each fart plays at its own length (ADR 0012), every burst of it (ADR 0016).
    expect(arranged).toHaveLength(128)
    for (const s of arranged) {
      expect(coverageOf(s, all).unlocked, s.id).toBe(unlockedByAll(s))
    }
    expect(iPhone.every(unlockedByAll)).toBe(true)
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
    expect(checked).toBe(50 * arranged.length)
  })

  it('unlocks 6 of the iPhone’s Songs at the 9th story take, and 11 by the 11th', () => {
    const unlocks: Record<number, string[]> = {}
    const before = new Set<string>()
    for (let take = 1; take <= story.length; take++) {
      const unlocked = iPhone.filter(s => coverageOf(s, takes(take)).unlocked).map(s => s.id)
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

  it('reads Mary on 095 alone as the compose journey expects (#288)', () => {
    // The journey's take of 095 can settle differently from the golden analysis, and with 095
    // alone Mary's two Arrangements nearly tie, so the journey accepts either Arrangement's note
    // names. This pins the golden answer: G covers G2, and C2, D2 and E2 are needed.
    const mary = coverageOf(song('mary'), fixtures(['095']))
    expect(coverageSummary(mary)).toBe('1 of 4 notes covered')
    expect(mary.transposition).toBe(-36)
    expect(missingNotes(mary)).toBe('C2 (1.5 s), D2 (0.7 s), and E2 (0.7 s)')
  })
})

describe('Pitch Coverage with Fart Choices (#372)', () => {
  /** The golden Fart Choices, which name fixtures, as they name this library's Recordings. */
  const asRecordings = (choices: GoldenChoices): FartChoices => ({
    transposition: choices.transposition,
    preferred: Object.fromEntries(
      Object.entries(choices.preferred).map(([pitch, id]) => [pitch, fixtureRecordingId(id)])
    ),
    excluded: choices.excluded.map(fixtureRecordingId)
  })

  it('reads every state of choices.json as the reference does, in Compose’s rows too', () => {
    let checked = 0
    let locks = 0
    for (const library of ['full', 'small'] as const) {
      const recordings = fixtures(libraries[library])
      for (const c of choiceCases.filter(c => c.library === library)) {
        const catalogSong = songs.find(s => s.id === c.song)
        if (!catalogSong) continue
        c.states.forEach((want, i) => {
          if (want.choices === null) return
          const label = `${c.case} ${library}/${c.song} state ${i}`
          const choices = asRecordings(want.choices)
          const coverage = coverageOf(catalogSong, recordings, choices)
          expect(coverage.unlocked, label).toBe(want.unlocked)
          expect([coverage.covered, coverage.total], label).toEqual([
            want.pitch_coverage.covered,
            want.pitch_coverage.total
          ])
          expect(coverage.transposition, label).toBe(want.transpose)
          expect(coverage.missing, label).toEqual(
            want.missing.map(m => ({ midi: m.target_midi, seconds: m.seconds }))
          )
          const [row] = songRows([catalogSong], recordings, new Map([[c.song, choices]]))
          expect(row.coverage, label).toEqual({
            covered: coverage.covered,
            total: coverage.total,
            hasMelodicRecordings: true,
            unlocked: coverage.unlocked
          })
          checked++
          if (!want.unlocked) locks++
        })
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(locks).toBeGreaterThan(100)
  })

  // The reference's golden case: Mary's only fart near E3 left out of the whole Fixture Library.
  const leftOut = choiceCases.find(
    c => c.case === 'leave_out_every' && c.library === 'full' && c.song === 'mary'
  )?.states[0]
  if (!leftOut?.choices) throw new Error('choices.json leaves a fart out of Mary')
  const maryLeftOut = new Map([['mary', asRecordings(leftOut.choices)]])

  it('moves the Song a leave-out locks to Compose’s locked Songs, naming the note it needs', () => {
    const inCompose = (allChoices?: ReadonlyMap<string, FartChoices>) => {
      const { unlocked, locked } = songListing(songRows(songs, all, allChoices), 'mary')
      return {
        unlocked: unlocked.some(r => r.song.id === 'mary'),
        locked: locked.some(r => r.song.id === 'mary')
      }
    }
    expect(inCompose()).toEqual({ unlocked: true, locked: false })
    expect(inCompose(maryLeftOut)).toEqual({ unlocked: false, locked: true })
    const coverage = coverageOf(song('mary'), all, maryLeftOut.get('mary'))
    expect(missingNotes(coverage)).toBe('E3 (1.5 s)')
  })

  it('names the notes Song Creator names, with no Melodic Recordings left', () => {
    const mary = song('mary')
    const choices = { transposition: -5, preferred: {}, excluded: [] }
    const coverage = coverageOf(mary, [], choices)
    expect(coverage.hasMelodicRecordings).toBe(false)
    expect(coverage.transposition).toBe(-5)
    expect(coverage.missing).toHaveLength(coverage.total)
    expect(coverage.missing).toEqual(arrangementOf(mary, [], choices).missingNotes)
    expect(coverageOf(mary, []).missing).toEqual([])
  })

  it('changes no other Song', () => {
    const before = songRows(songs, all)
    const after = songRows(songs, all, maryLeftOut)
    expect(
      after.flatMap((row, i) =>
        row.coverage.unlocked === before[i].coverage.unlocked ? [] : [row.song.id]
      )
    ).toEqual(['mary'])
  })

  it('shows no unlock on the Result for a Song the leave-out still locks', () => {
    // Saving 002, the only fart long enough for Amazing Grace, which the user left out of it.
    const grace = song('amazing')
    const { transposition } = coverageOf(grace, all)
    const graceLeftOut = new Map([
      [grace.id, { transposition, preferred: {}, excluded: [fixtureRecordingId('002')] }]
    ])
    const unlockedIds = (allChoices?: ReadonlyMap<string, FartChoices>) =>
      coverageChanges(songs, without002, all, allChoices).unlocked.map(u => u.song.id)
    expect(unlockedIds()).toContain(grace.id)
    expect(unlockedIds(graceLeftOut)).not.toContain(grace.id)
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
  const test = (pitches: number[]): Song => {
    const distinct = [...new Set(pitches)].sort((a, b) => a - b)
    return {
      id: 'test',
      title: 'Test',
      source: '',
      kind: 'Songs',
      fame: 0,
      views: 0,
      lengthBeats: pitches.length,
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
  /** `recordings` with the fixture's Recording given `placedPitch`. */
  const place = (recordings: Recording[], fixture: string, placed: number | null) =>
    recordings.map(r => (fixtureId(r.id) === fixture ? { ...r, placedPitch: placed } : r))
  /** The golden small library, all six Melodic, and 065, Noise-like and 1.49 s long. */
  const small = fixtures(libraries.small)
  const with065 = fixtures([...libraries.small, '065'])

  it('covers its note like a Melodic Recording: 065 on C2 unlocks 5 Songs the small library leaves locked', () => {
    // The same Arrangements as `tools/melody-lab/test_placed.py`.
    expect(iPhoneListing(with065).unlocked.map(r => r.song.id)).toEqual(['mary', 'saints'])
    const placed = place(with065, '065', C2)
    const { unlocked, locked } = iPhoneListing(placed)
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

  it('counts only a whole note from C2 to B4, as the review offers', () => {
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

  it('leaves a Melodic Recording out with "No note": 002 out locks Amazing Grace (#314)', () => {
    const left = place(all, '002', NO_NOTE)
    expect(coverageKey(left)).toBe(coverageKey(without002))
    expect(iPhoneListing(left).locked.map(r => r.song.id)).toEqual(['amazing'])
    expect(coverageKey(place(all, '002', null))).toBe(coverageKey(all))
  })

  it('shows no unlock for a Noise-like save until it is placed', () => {
    expect(coverageChanges(songs, small, with065).unlocked).toEqual([])
    const placed = coverageChanges(iPhone, small, place(with065, '065', C2))
    expect(placed.unlocked.map(u => u.song.id)).toEqual([
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
    const { unlocked, locked } = iPhoneListing(ten)
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
    const { unlocked, locked } = iPhoneListing(ten, 'alphabetical')
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
    const ids = (rows: { song: SongSummary }[]) => rows.map(r => r.song.id)
    expect(ids(listing(ten, 'JINGLE').unlocked)).toEqual(['jingle'])
    expect(ids(listing(ten, 'fur').unlocked)).toEqual(['furelise'])
    expect(ids(listing(ten, 'frere').unlocked)).toEqual(['frere'])
    expect(ids(listing(ten, 'little').unlocked)).toEqual(['mary', 'twinkle', 'little-peggys-love'])
    expect(ids(listing(ten, 'BIRTH').locked)).toEqual(['birthday'])
    expect(listing(ten, '  ')).toEqual(listing(ten))
    const none = listing(ten, 'zzz')
    expect(none.unlocked.length + none.locked.length).toBe(0)
  })

  it('finds a Song by another of its names, ignoring punctuation (#323)', () => {
    const found = (query: string) => {
      const { unlocked, locked } = listing(all, query)
      return [...unlocked, ...locked].map(r => r.song.id)
    }
    expect(song('danny-boy').aliases).toContain('Londonderry Air')
    expect(found('londonderry')).toEqual(['danny-boy'])
    expect(found('tetris')).toEqual(['korobeiniki'])
    expect(found('ROW ROW')).toContain('row')
    expect(found('little twinkle')).toEqual([])
    expect(found('twinkle, twinkle')).toEqual(['twinkle'])
    expect(found('Frère')).toEqual(found('frere'))
    expect(found('!?')).toHaveLength(songs.length)
  })

  it('counts every Song as its Arrangement does, after each take of the story (#323)', () => {
    for (let count = 0; count <= story.length; count++) {
      for (const { song, coverage } of songRows(songs, takes(count))) {
        const { covered, total, hasMelodicRecordings, unlocked } = coverageOf(song, takes(count))
        expect(coverage, `${count} takes, ${song.id}`).toEqual({
          covered,
          total,
          hasMelodicRecordings,
          unlocked
        })
      }
    }
  })

  describe('Favorite Songs (#313)', () => {
    const ids = (rows: { song: SongSummary }[]) => rows.map(r => r.song.id)
    // Two Unlocked Songs and a locked one on the first 10 takes.
    const favorites = new Set(['twinkle', 'mary', 'birthday'])

    it('filters to Favorite Songs, keeping both sections and the order', () => {
      const { unlocked, locked } = listing(ten, '', 'closestToUnlocking', { favorites })
      expect(ids(unlocked)).toEqual(['mary', 'twinkle'])
      expect(ids(locked)).toEqual(['birthday'])
      const az = listing(ten, '', 'alphabetical', { favorites })
      expect(ids(az.unlocked)).toEqual(['mary', 'twinkle'])
    })

    it('searches within the filter', () => {
      expect(ids(listing(ten, 'little', 'closestToUnlocking', { favorites }).unlocked)).toEqual([
        'mary',
        'twinkle'
      ])
      const twinkle = listing(ten, 'TWINKLE', 'closestToUnlocking', {
        favorites: new Set(['mary'])
      })
      expect(twinkle.unlocked.length + twinkle.locked.length).toBe(0)
    })

    it('shows nothing with no Favorite Songs, and ignores ids not in the catalog', () => {
      const none = listing(ten, '', 'closestToUnlocking', { favorites: new Set() })
      expect(none.unlocked.length + none.locked.length).toBe(0)
      const gone = listing(ten, '', 'closestToUnlocking', { favorites: new Set(['gone', 'mary']) })
      expect(ids(gone.unlocked)).toEqual(['mary'])
      expect(gone.locked).toEqual([])
    })
  })

  describe("Compose's sorts, Ready filter and composer search (#356)", () => {
    const ids = (rows: { song: SongSummary }[]) => rows.map(r => r.song.id)
    const every = (l: { unlocked: SongRow[]; locked: SongRow[] }) => [...l.unlocked, ...l.locked]

    // #384: by fame, Wikipedia pageviews and PDMX views together, not the one score's views.
    it('sorts Most popular by fame', () => {
      // The whole Fixture Library unlocks all 12.
      expect(ids(iPhoneListing(all, 'mostPopular').unlocked)).toEqual([
        'birthday', // 11.201
        'amazing', // 10.954
        'auld', // 10.603
        'twinkle', // 10.339
        'jingle', // 10.054
        'merryxmas', // 9.768
        'furelise', // 9.705
        'ode', // 9.672
        'saints', // 9.551
        'frere', // 9.487
        'mary', // 9.294
        'row' // 8.292
      ])
      const { locked } = listing([], '', 'mostPopular')
      const fame = locked.map(r => r.song.fame)
      expect(fame).toEqual([...fame].sort((a, b) => b - a))
    })

    it('breaks Most popular’s ties by views, then rating, then catalog order', () => {
      const base = song('mary')
      const coverage = { covered: 0, total: 4, hasMelodicRecordings: false, unlocked: false }
      const row = (id: string, fame: number, views: number, rating?: number): SongRow => ({
        song: { ...base, id, fame, views, rating },
        coverage
      })
      const rows = [
        row('a', 5, 10, 4),
        row('b', 5, 10, 4.5),
        row('c', 5, 10),
        row('d', 5, 20),
        row('e', 5, 10, 4.5),
        row('f', 6, 1)
      ]
      expect(ids(sortRows(rows, 'mostPopular'))).toEqual(['f', 'd', 'b', 'e', 'a', 'c'])
    })

    it('sorts Fewest notes by the Song’s distinct notes, then catalog order', () => {
      expect(ids(iPhoneListing(all, 'fewestNotes').unlocked)).toEqual([
        'mary', // 4 notes
        'jingle', // 5
        'saints',
        'ode',
        'twinkle', // 6
        'row',
        'amazing',
        'frere', // 7
        'merryxmas',
        'furelise',
        'auld',
        'birthday' // 8
      ])
      const { locked } = listing([], '', 'fewestNotes')
      const notes = locked.map(r => r.song.pitches.length)
      expect(notes).toEqual([...notes].sort((a, b) => a - b))
    })

    it('keeps every Song in its section, whatever the order', () => {
      const closest = listing(ten)
      for (const order of ['mostPopular', 'fewestNotes', 'alphabetical'] as const) {
        const sorted = listing(ten, '', order)
        expect(new Set(ids(sorted.unlocked))).toEqual(new Set(ids(closest.unlocked)))
        expect(new Set(ids(sorted.locked))).toEqual(new Set(ids(closest.locked)))
      }
    })

    it('filters to the Ready Songs, in the order chosen', () => {
      for (const order of ['closestToUnlocking', 'mostPopular', 'fewestNotes'] as const) {
        const ready = listing(ten, '', order, { ready: true })
        expect(ready.unlocked).toEqual(listing(ten, '', order).unlocked)
        expect(ready.locked).toEqual([])
      }
      const none = listing([], '', 'closestToUnlocking', { ready: true })
      expect(every(none)).toEqual([])
    })

    it('filters to Ready Favorite Songs with both filters on', () => {
      const favorites = new Set(['twinkle', 'mary', 'birthday'])
      const both = listing(ten, '', 'closestToUnlocking', { ready: true, favorites })
      expect(ids(both.unlocked)).toEqual(['mary', 'twinkle'])
      expect(both.locked).toEqual([])
      const lockedOnly = listing(ten, '', 'closestToUnlocking', {
        ready: true,
        favorites: new Set(['birthday'])
      })
      expect(every(lockedOnly)).toEqual([])
      const readyLittle = listing(ten, 'little', 'closestToUnlocking', { ready: true })
      expect(ids(readyLittle.unlocked)).toEqual(['mary', 'twinkle', 'little-peggys-love'])
      expect(readyLittle.locked).toEqual([])
    })

    it('finds Songs by their composer, ignoring case, accents and punctuation', () => {
      const found = (query: string) => ids(every(listing(all, query))).sort()
      // Every Song whose title, other names or composer has the query, from the catalog.
      const named = (query: string) =>
        songs
          .filter(s =>
            [s.title, ...(s.aliases ?? []), s.composer ?? ''].some(name =>
              searchKey(name).includes(searchKey(query))
            )
          )
          .map(s => s.id)
          .sort()
      expect(found('mozart')).toEqual(named('mozart'))
      expect(found('mozart')).toEqual(
        expect.arrayContaining([
          'eine-kleine',
          'komm-lieber-mai',
          'clarinet-concerto-in-a-major-k-622'
        ])
      )
      expect(song('ode').title).not.toMatch(/beethoven/i)
      expect(found('BEETHOVEN')).toContain('ode')
      expect(found('chopin')).toEqual(named('chopin'))
      expect(found('chopin')).toContain('nocturne-op-9-no-2')
      expect(found('frederic')).toEqual(found('Frédéric'))
      expect(found("o'carolan")).toEqual(found('ocarolan'))
    })

    it('finds Songs by their origin and kind words (#384)', () => {
      const found = (query: string) => ids(every(listing(all, query))).sort()
      const where = (test: (s: SongSummary) => boolean) => songs.filter(test).map(s => s.id)
      // "Irish" finds every Irish Song, not only those with the word in a title or composer.
      const irish = where(s => s.origin === 'Irish')
      expect(irish.length).toBeGreaterThan(50)
      expect(found('Irish')).toEqual(expect.arrayContaining(irish))
      expect(found('irish').length).toBeGreaterThan(
        where(s => /irish/i.test(`${s.title} ${s.composer}`)).length
      )
      expect(found('irish')).toEqual(
        where(s => s.origin === 'Irish' || /irish/i.test(`${s.title} ${s.composer}`)).sort()
      )
      // "Christmas" and "hymn" find their kinds.
      const christmas = where(s => s.kind === 'Christmas')
      expect(found('christmas')).toEqual(expect.arrayContaining(christmas))
      expect(found('hymn')).toEqual(expect.arrayContaining(where(s => s.kind === 'Hymns')))
      expect(found('Fiddle tunes')).toEqual(where(s => s.kind === 'Fiddle tunes').sort())
      // Every Song is a Song: "song" finds the titles with the word, not the kind Songs.
      expect(found('song')).toEqual(
        where(s =>
          [s.title, ...(s.aliases ?? []), s.composer ?? ''].some(n => /song/i.test(n))
        ).sort()
      )
      expect(where(s => s.kind === 'Songs').length).toBeGreaterThan(found('song').length)
      // An origin of two words is found by either.
      expect(found('african')).toEqual(
        expect.arrayContaining(where(s => s.origin === 'African American'))
      )
    })

    it('finds no Song by the name its score gives but #357 doesn’t', () => {
      // Red River Valley's score names "Joe Buchanan's Scottish Tome"; #357 calls it a folk song.
      expect(song('red-river-valley').composer).toBe('Traditional')
      expect(ids(every(listing(all, 'buchanan')))).toEqual([])
    })
  })

  describe('the Kind filter (#384, #397)', () => {
    const ids = (rows: { song: SongSummary }[]) => rows.map(r => r.song.id)
    const every = (l: { unlocked: SongRow[]; locked: SongRow[] }) => [...l.unlocked, ...l.locked]
    const kinded = (kind: KindChoice, recordings: Recording[] = ten, filters: SongFilters = {}) =>
      listing(recordings, '', 'closestToUnlocking', { ...filters, kinds: [kind] })

    it('shows only the Songs of the kind chosen, every kind having some', () => {
      for (const kind of songKinds) {
        const shown = every(kinded(kind))
        expect(shown.length, kind).toBeGreaterThan(30)
        expect(
          shown.filter(r => r.song.kind !== kind),
          kind
        ).toEqual([])
        expect(shown.length, kind).toBe(songs.filter(s => s.kind === kind).length)
      }
      // Each Song is of exactly one kind.
      const counts = songKinds.map(kind => every(kinded(kind)).length)
      expect(counts.reduce((a, b) => a + b)).toBe(songs.length)
    })

    it('shows the Well known Songs of every kind', () => {
      const known = every(kinded('Well known'))
      expect(ids(known).sort()).toEqual(
        songs
          .filter(s => s.wellKnown)
          .map(s => s.id)
          .sort()
      )
      expect(known.length).toBeGreaterThan(200)
      expect(new Set(known.map(r => r.song.kind)).size).toBe(songKinds.length)
      // The iPhone app's 12 are all Well known.
      expect(ids(known)).toEqual(expect.arrayContaining(iPhone.map(s => s.id)))
      // No Kind shows every Song.
      expect(listing(ten, '', 'closestToUnlocking', { kinds: [] })).toEqual(listing(ten))
    })

    it('shows a Song in any of several Kinds, once', () => {
      const several = every(listing(ten, '', 'alphabetical', { kinds: ['Christmas', 'Hymns'] }))
      expect(ids(several).sort()).toEqual(
        songs
          .filter(s => s.kind === 'Christmas' || s.kind === 'Hymns')
          .map(s => s.id)
          .sort()
      )
      // A Well known Hymn is in both Kinds, and still lists once.
      const hymn = song('amazing')
      expect([hymn.kind, hymn.wellKnown]).toEqual(['Hymns', true])
      const both = ids(every(listing(ten, '', 'alphabetical', { kinds: ['Well known', 'Hymns'] })))
      expect(both.filter(id => id === hymn.id)).toEqual([hymn.id])
      expect(both).toHaveLength(new Set(both).size)
      expect(both.length).toBe(songs.filter(s => s.wellKnown || s.kind === 'Hymns').length)
    })

    it('keeps both sections and the order chosen', () => {
      const christmas = kinded('Christmas')
      expect(ids(christmas.unlocked)).toEqual(expect.arrayContaining(['jingle', 'merryxmas']))
      expect(christmas.locked.length).toBeGreaterThan(0)
      for (const order of ['closestToUnlocking', 'mostPopular', 'fewestNotes'] as const) {
        const sorted = listing(ten, '', order, { kinds: ['Christmas'] })
        const whole = listing(ten, '', order)
        const isChristmas = (r: SongRow) => r.song.kind === 'Christmas'
        expect(ids(sorted.unlocked)).toEqual(ids(whole.unlocked.filter(isChristmas)))
        expect(ids(sorted.locked)).toEqual(ids(whole.locked.filter(isChristmas)))
      }
    })

    it('combines with Ready, Favorites and search', () => {
      const readyKids = kinded('Kids', ten, { ready: true })
      expect(ids(readyKids.unlocked)).toEqual(
        ids(listing(ten).unlocked.filter(r => r.song.kind === 'Kids'))
      )
      expect(ids(readyKids.unlocked)).toEqual(
        expect.arrayContaining(['mary', 'twinkle', 'row', 'frere'])
      )
      expect(readyKids.locked).toEqual([])
      const favorites = new Set(['twinkle', 'jingle', 'birthday'])
      const kids = kinded('Kids', ten, { favorites })
      expect(ids(every(kids))).toEqual(['twinkle'])
      expect(every(kinded('Songs', ten, { favorites })).map(r => r.song.id)).toEqual(['birthday'])
      // Happy Birthday is a Favorite Song, but not unlocked yet.
      expect(every(kinded('Songs', ten, { favorites, ready: true }))).toEqual([])
      const littleKids = listing(ten, 'little', 'closestToUnlocking', { kinds: ['Kids'] })
      expect(ids(littleKids.unlocked)).toEqual(['mary', 'twinkle'])
      // Little Peggy's Love has "little" in its title, but it's a fiddle tune.
      expect(song('little-peggys-love').kind).toBe('Fiddle tunes')
      expect(
        ids(every(listing(ten, 'little', 'closestToUnlocking', { kinds: ['Well known'] })))
      ).toEqual(expect.arrayContaining(['mary', 'twinkle']))
    })
  })

  it('unlocks the Songs the reference does with the whole Fixture Library', () => {
    const { unlocked, locked } = listing(all)
    expect(unlocked.length + locked.length).toBe(songs.length)
    const isArranged = (r: { song: SongSummary }) => songIds.includes(r.song.id)
    expect(unlocked.filter(isArranged).every(r => unlockedByAll(r.song))).toBe(true)
    expect(locked.filter(isArranged).every(r => !unlockedByAll(r.song))).toBe(true)
  })

  it('unlocks all 12 of the iPhone’s Songs with the whole Fixture Library, and 11 without 002', () => {
    expect(iPhoneListing(all).unlocked).toHaveLength(12)
    expect(iPhoneListing(all).locked).toEqual([])
    const { unlocked, locked } = iPhoneListing(without002)
    expect(unlocked).toHaveLength(11)
    expect(locked.map(r => r.song.id)).toEqual(['amazing'])
    expect(locked.map(r => missingNotes(coverageOf(r.song, without002)))).toEqual(['E3 (3.0 s)'])
  })

  it('locks 41 more of the catalog’s Songs without 002, Amazing Grace among them', () => {
    // `e2e/fixture-library.spec.ts` deletes 002 and expects Compose to lock these more. 40 until
    // #357 pulled one of them as under copyright, 39 until Scarborough Fair and The Flower of the
    // Quern took in the held note they end on (#389), 41 until Nocturne Op 9 No 2 did (#394), 42
    // until The Female Saylor's new score spanned 8 semitones, not 19, and needed no 002 (#396).
    const ids = (rows: { song: SongSummary }[]) => rows.map(r => r.song.id)
    const withAll = new Set(ids(listing(all).locked))
    const lockedNow = ids(listing(without002).locked).filter(id => !withAll.has(id))
    expect(lockedNow).toHaveLength(41)
    expect(lockedNow).toContain('amazing')
    expect(listing(without002).unlocked.every(r => !withAll.has(r.song.id))).toBe(true)
  })

  it('locks every Song, fewest notes first, without Melodic Recordings', () => {
    const { unlocked, locked } = listing(fixtures(['018']))
    expect(unlocked).toHaveLength(0)
    expect(locked).toHaveLength(songs.length)
    const notes = locked.map(r => r.coverage.total)
    expect(notes).toEqual([...notes].sort((a, b) => a - b))
    expect(iPhoneListing(fixtures(['018'])).locked[0].song.id).toBe('mary')
    for (const r of locked) {
      expect(r.coverage.hasMelodicRecordings).toBe(false)
      expect(missingNotes(coverageOf(r.song, fixtures(['018'])))).toBeNull()
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
    // The Songs the first 10 takes unlock, as often as each comes round.
    const unlocks = new Set(listing(ten).unlocked.map(r => r.song))
    expect(unlocked).toHaveLength(
      catalog.filter((_, i) => unlocks.has(songs[i % songs.length])).length
    )
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
  })

  it('matches the catalog again only when the Melodic Recordings change', () => {
    const eight = takes(8)
    const noise = fixtures(['055'])
    // A Noise-like Recording (055) changes nothing; the 9th take, a Melodic one, does.
    expect(coverageKey([...eight, ...noise])).toBe(coverageKey(eight))
    expect(coverageKey(takes(9))).not.toBe(coverageKey(eight))
    const analyzing: Recording = { ...takes(9)[8], analysis: { state: 'analyzing' } }
    expect(coverageKey([...eight, analyzing])).toBe(coverageKey(eight))
    expect(iPhoneListing(eight).unlocked).toEqual([])
    expect(iPhoneListing(takes(9)).unlocked.map(r => r.song.id)).toEqual([
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
    const changes = coverageChanges(iPhone, takes(8), takes(9))
    expect(changes.unlocked.map(u => u.song.id)).toEqual([
      'mary',
      'jingle',
      'saints',
      'row',
      'ode',
      'merryxmas'
    ])
    // Each with the Pitch Coverage it had before, which the Result's reward starts from (#363).
    for (const { song: unlocked, before } of changes.unlocked) {
      const was = coverageOf(unlocked, takes(8))
      expect([before.covered, before.total], unlocked.id).toEqual([was.covered, was.total])
      expect([was.unlocked, before.unlocked], unlocked.id).toEqual([false, false])
    }
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
    expect(coverageChanges(iPhone, without002, without002).closest?.song.id).toBe('amazing')
    expect(coverageChanges(iPhone, all, all).closest).toBeNull()
  })
})

describe('the order of the Songs a save unlocked (#363)', () => {
  /** An unlock of a Song like Mary's, with its own id, views and rating. */
  const unlock = (id: string, views: number, rating?: number) => ({
    song: { ...song('mary'), id, views, ...(rating === undefined ? {} : { rating }) }
  })
  const ids = (unlocked: { song: SongSummary }[]) => unlocked.map(u => u.song.id)

  it('puts Favorites first, then the most viewed, then the best rated, then catalog order', () => {
    const unlocked = [
      unlock('few', 5),
      unlock('rated', 900, 4.1),
      unlock('best', 900, 4.8),
      unlock('unrated', 900),
      unlock('unrated-later', 900),
      unlock('favorite', 0),
      unlock('favorite-later', 0)
    ]
    expect(ids(orderUnlocked(unlocked, new Set(['favorite', 'favorite-later'])))).toEqual([
      'favorite',
      'favorite-later',
      'best',
      'rated',
      'unrated',
      'unrated-later',
      'few'
    ])
    // A Favorite with no views still comes before the most viewed Song.
    expect(ids(orderUnlocked(unlocked, new Set(['few'])))[0]).toBe('few')
  })

  it("orders a real save's unlocks, and leaves the list it's given alone", () => {
    const { unlocked } = coverageChanges(iPhone, takes(8), takes(9))
    const catalogOrder = ids(unlocked)
    expect(ids(orderUnlocked(unlocked, new Set()))).toEqual([
      'ode',
      'row',
      'saints',
      'jingle',
      'merryxmas',
      'mary'
    ])
    expect(ids(orderUnlocked(unlocked, new Set(['mary', 'not-unlocked'])))).toEqual([
      'mary',
      'ode',
      'row',
      'saints',
      'jingle',
      'merryxmas'
    ])
    expect(ids(unlocked)).toEqual(catalogOrder)
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

  it('is its Trim’s fart once trimmed, Melodic or not (#314)', () => {
    const fart = { startSeconds: 0.6, endSeconds: 1.8 }
    const trimmed = { ...take(1, 60, 2.4), trim: { startSeconds: 0.55, endSeconds: 1.9, fart } }
    expect(formattedFartLength(trimmed)).toBe('1.2 s')
    expect(coverageKey([trimmed])).not.toBe(coverageKey([take(1, 60, 2.4)]))
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
