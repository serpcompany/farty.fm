import { describe, expect, it } from 'vitest'
import { songs } from '@/test-support/songs.generated'
import {
  allFixtures,
  catalogSong,
  fixtures,
  iPhoneListing,
  story,
  takes,
  unlockedByAll,
  without002
} from '../test-support/fixture-recordings'
import type { SongSummary } from './catalog/song'
import {
  coverageKey,
  coverageOf,
  missingNotes,
  type SongOrder,
  songListing,
  songRows,
  sortRows
} from './pitch-coverage'
import type { Recording } from './recordings'

const ten = takes(10)

const listing = (
  recordings: Recording[],
  query = '',
  order: SongOrder = 'closestToUnlocking',
  favorites: ReadonlySet<string> = new Set(),
  only: ReadonlySet<string> | null = null
) => songListing(sortRows(songRows(songs, recordings), order, favorites), query, only)

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
    expect(ids(listing(ten, 'little').unlocked)).toEqual(['mary', 'twinkle'])
    expect(ids(listing(ten, 'BIRTH').locked)).toEqual(['birthday'])
    expect(listing(ten, '  ')).toEqual(listing(ten))
    const none = listing(ten, 'zzz')
    expect(none.unlocked.length + none.locked.length).toBe(0)
  })

  it('finds a Song by another of its names, ignoring punctuation (#323)', () => {
    const found = (query: string) => {
      const { unlocked, locked } = listing(allFixtures, query)
      return [...unlocked, ...locked].map(r => r.song.id)
    }
    expect(catalogSong('danny-boy').aliases).toContain('Londonderry Air')
    expect(found('londonderry')).toEqual(['danny-boy'])
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
    const favorites = new Set(['twinkle', 'mary', 'birthday'])

    it('puts Favorite Songs first, each part closest to unlocking', () => {
      const closest = listing(ten)
      const { unlocked, locked } = listing(ten, '', 'favoritesFirst', favorites)
      expect(ids(unlocked)).toEqual([
        'mary',
        'twinkle',
        ...ids(closest.unlocked).filter(id => !favorites.has(id))
      ])
      expect(ids(locked)).toEqual([
        'birthday',
        ...ids(closest.locked).filter(id => !favorites.has(id))
      ])
    })

    it('sorts closest to unlocking when there are no Favorite Songs', () => {
      expect(listing(ten, '', 'favoritesFirst')).toEqual(listing(ten))
    })

    it('filters to Favorite Songs, keeping both sections and the order', () => {
      const { unlocked, locked } = listing(ten, '', 'closestToUnlocking', favorites, favorites)
      expect(ids(unlocked)).toEqual(['mary', 'twinkle'])
      expect(ids(locked)).toEqual(['birthday'])
      const az = listing(ten, '', 'alphabetical', favorites, favorites)
      expect(ids(az.unlocked)).toEqual(['mary', 'twinkle'])
    })

    it('searches within the filter', () => {
      expect(
        ids(listing(ten, 'little', 'closestToUnlocking', favorites, favorites).unlocked)
      ).toEqual(['mary', 'twinkle'])
      const twinkle = listing(ten, 'TWINKLE', 'closestToUnlocking', favorites, new Set(['mary']))
      expect(twinkle.unlocked.length + twinkle.locked.length).toBe(0)
    })

    it('shows nothing with no Favorite Songs, and ignores ids not in the catalog', () => {
      const none = listing(ten, '', 'closestToUnlocking', new Set(), new Set())
      expect(none.unlocked.length + none.locked.length).toBe(0)
      const gone = listing(ten, '', 'closestToUnlocking', new Set(), new Set(['gone', 'mary']))
      expect(ids(gone.unlocked)).toEqual(['mary'])
      expect(gone.locked).toEqual([])
    })
  })

  it('unlocks the Songs the reference does with the whole Fixture Library', () => {
    const { unlocked, locked } = listing(allFixtures)
    expect(unlocked.length + locked.length).toBe(songs.length)
    expect(unlocked.every(r => unlockedByAll(r.song))).toBe(true)
    expect(locked.every(r => !unlockedByAll(r.song))).toBe(true)
  })

  it('unlocks all 12 of the iPhone’s Songs with the whole Fixture Library, and 11 without 002', () => {
    expect(iPhoneListing(allFixtures).unlocked).toHaveLength(12)
    expect(iPhoneListing(allFixtures).locked).toEqual([])
    const { unlocked, locked } = iPhoneListing(without002)
    expect(unlocked).toHaveLength(11)
    expect(locked.map(r => r.song.id)).toEqual(['amazing'])
    expect(locked.map(r => missingNotes(coverageOf(r.song, without002)))).toEqual(['E3 (3.0 s)'])
  })

  it('locks 11 more of the catalog’s Songs without 002, Amazing Grace among them', () => {
    const ids = (rows: { song: SongSummary }[]) => rows.map(r => r.song.id)
    const withAll = new Set(ids(listing(allFixtures).locked))
    const lockedNow = ids(listing(without002).locked).filter(id => !withAll.has(id))
    expect(lockedNow).toHaveLength(11)
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
    const unlocks = new Set(listing(ten).unlocked.map(r => r.song))
    expect(unlocked).toHaveLength(
      catalog.filter((_, i) => unlocks.has(songs[i % songs.length])).length
    )
    expect(ms).toBeLessThan(10_000)
  })

  it('names the missing notes with their octave and length', () => {
    expect(missingNotes(coverageOf(catalogSong('birthday'), ten))).toBe('A2 (0.5 s)')
    expect(missingNotes(coverageOf(catalogSong('amazing'), ten))).toBe('A3 (3.0 s)')
    expect(missingNotes(coverageOf(catalogSong('mary'), ten))).toBeNull()
    const few = takes(3)
    expect(missingNotes(coverageOf(catalogSong('birthday'), few))).toBe(
      'B2 (0.5 s), C♯3 (0.5 s), E3 (1.5 s), F♯3 (0.5 s), A3 (0.4 s), and B3 (0.5 s)'
    )
    expect(missingNotes(coverageOf(catalogSong('birthday'), few), 3)).toBe(
      'B2 (0.5 s), C♯3 (0.5 s), E3 (1.5 s), and 3 more'
    )
    expect(missingNotes(coverageOf(catalogSong('mary'), few), 3)).toBe(
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
    expect(iPhoneListing(eight).unlocked).toEqual([])
    expect(iPhoneListing(takes(9)).unlocked.map(r => r.song.id)).toEqual([
      'mary',
      'jingle',
      'saints',
      'ode',
      'row',
      'merryxmas'
    ])
    const [first, second, ...rest] = eight
    if (second.analysis.state !== 'analyzed') throw new Error('The 2nd take is analyzed')
    const { settleSeconds, ...stored } = second.analysis.analysis
    expect(settleSeconds).toBeGreaterThan(0)
    const unknown: Recording = { ...second, analysis: { state: 'analyzed', analysis: stored } }
    expect(coverageKey([first, unknown, ...rest])).not.toBe(coverageKey(eight))
  })
})
