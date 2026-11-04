import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../../test-support/golden'
import { songPitches } from '../engine/auto-map'
import { catalogPath } from './catalog-path.generated'
import {
  type CatalogEntry,
  catalogSongs,
  type GoldenSong,
  outOfDate,
  readSources,
  renderCatalog,
  shippedIds,
  titleNames
} from './generate'
import type { SongSummary } from './song'
import { songIndex } from './song-index.generated'
import { songs } from './songs.generated'

const sources = readSources()

describe('the Song Catalog in the app', () => {
  test('is what the generator writes from catalog/ and fixtures/golden/songs/', () => {
    expect(outOfDate(renderCatalog(sources))).toEqual([])
  })

  // #322: the browser fetches the file the server and the tests import, by its content's name.
  // #323: that file is the index, every Song but its notes, and each Song's notes are a file of
  // their own, fetched as the Song opens.
  test('is an index the browser fetches by its content and the server imports', () => {
    const files = renderCatalog(sources)
    expect(`public${catalogPath}`).toBe(files.data.path)
    expect(files.index.text).toContain(`'../../../${files.data.path}'`)
    expect(files.songs.text).toContain(`'../../../${files.data.path}'`)
    const index: SongSummary[] = JSON.parse(files.data.text)
    expect(index).toEqual(songs.map(({ bar_lines, length_beats, notes, ...summary }) => summary))
    expect(index).toEqual(songIndex)
  })

  test('has each Song’s notes in a file of their own, named by its content', () => {
    const files = renderCatalog(sources)
    expect(files.notes).toHaveLength(songs.length)
    for (const [i, song] of songs.entries()) {
      const file = files.notes[i]
      expect(file.path).toBe(`public${song.notesPath}`)
      expect(file.path).toMatch(new RegExp(`^public/catalog/notes/${song.id}-[0-9a-f]{16}\\.json$`))
      const { bar_lines, length_beats, notes } = song
      expect(JSON.parse(file.text)).toEqual({ bar_lines, length_beats, notes })
      expect(files.songs.text).toContain(`'../../../${file.path}'`)
    }
  })

  // Compose reads Pitch Coverage from the index alone: Auto-map reads only these of a Song.
  test.each(songs)('$id has the pitches and note lengths Auto-map reads', song => {
    expect({ bpm: song.bpm, pitches: song.pitches, durations: song.durations }).toEqual(
      songPitches(song)
    )
  })

  test("holds the iPhone app's 12 Songs first, in its order", () => {
    expect(songs.slice(0, 12).map(s => s.id)).toEqual([
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
  })

  // #350: every Song in catalog/ then, but the second Ode to Joy (#229). #357 pulled 16 Songs as
  // under copyright, and #380 2 whose only scores lose the tune when read as one part.
  test('then every other Song in the catalog, in its order, but ode-mutopia', () => {
    const ids = songs.map(s => s.id)
    expect(ids).toHaveLength(990)
    const first = ids.slice(0, 12)
    const catalogOrder = sources.catalog
      .map(e => e.id)
      .filter(id => !first.includes(id) && id !== 'ode-mutopia')
    expect(ids.slice(12)).toEqual(catalogOrder)
  })

  test.each(songs)('$id has the golden notes and its cited source', song => {
    const golden = sources.golden(song.id)
    const entry = sources.catalog.find(e => e.id === song.id) as CatalogEntry
    expect(song.notes).toEqual(golden.notes)
    expect([song.bpm, song.bar_lines, song.length_beats]).toEqual([
      golden.bpm,
      golden.bar_lines,
      golden.length_beats
    ])
    expect(song.pitches).toEqual(golden.pitches)
    expect(song.title).toBe(entry.title)
    expect(song.source).toBe('Public domain score · PDMX')
  })
})

// export_golden.py writes every catalog Song's melody, which the generator reads, so a Song
// can't ship without it. It arranges the Songs the app shipped before #350, the hand-entered ones
// and the first three PDMX batches, which the Auto-map and renderer tests check against the
// reference; every later Song passed tools/catalog/import_pdmx.py's render gate on it.
describe('the golden data', () => {
  const golden = `${REPO_ROOT}/fixtures/golden`
  const index = JSON.parse(readFileSync(`${golden}/index.json`, 'utf8')) as {
    songs: { id: string }[]
  }

  test('has the melody of every Song in the catalog', () => {
    const missing = sources.catalog.filter(e => !existsSync(`${golden}/songs/${e.id}.json`))
    expect(missing.map(e => e.id)).toEqual([])
  })

  test.each(index.songs.map(s => s.id))('arranges %s, in both libraries', id => {
    for (const file of [`arrangements/full/${id}.json`, `arrangements/small/${id}.json`])
      expect(existsSync(`${golden}/${file}`), file).toBe(true)
  })

  test('arranges the 129 Songs the reference engine checks the port against', () => {
    expect(index.songs).toHaveLength(129)
  })
})

describe('the generator', () => {
  test('ships every Song in the catalog but ode-mutopia, the same tune as ode', () => {
    expect(songs.map(s => s.id)).toEqual(shippedIds(sources.catalog))
    const shipped = new Set(songs.map(s => s.id))
    expect(sources.catalog.map(e => e.id).filter(id => !shipped.has(id))).toEqual(['ode-mutopia'])
  })

  test("refuses a Song that isn't in the catalog", () => {
    expect(() => renderCatalog(sources, ['twinkle', 'not-a-song'])).toThrow(/not-a-song/)
  })

  test("refuses notes that weren't imported from the cited score", () => {
    const changed = {
      ...sources,
      golden: (id: string) => ({ ...sources.golden(id), sha256: '0'.repeat(64) })
    }
    expect(() => renderCatalog(changed, ['mary'])).toThrow(/cited score/)
  })

  // #350: every Song's notes come from its golden copy, so one left stale after a change to the
  // entry's render arguments, or edited by hand, fails here and in `generate.ts --check`.
  test.each([
    [
      'its render arguments',
      (g: GoldenSong) => ({ ...g, import_args: { ...g.import_args, max_beats: 99 } }),
      /render arguments/
    ],
    [
      'the tracks it reads',
      (g: GoldenSong) => ({ ...g, import_args: { ...g.import_args, track: [0, 1] } }),
      /render arguments/
    ],
    ['its meter', (g: GoldenSong) => ({ ...g, beats_per_bar: 3 }), /another meter/],
    [
      'a note past its end',
      (g: GoldenSong) => ({ ...g, notes: [...g.notes, { start: 64, dur: 1, pitch: 72 }] }),
      /on or after beat/
    ]
  ])('refuses a golden copy that differs from its catalog entry in %s', (_, edit, error) => {
    const id = 'danny-boy'
    const entry = sources.catalog.find(e => e.id === id)
    expect(entry?.render).toMatchObject({ max_beats: expect.any(Number), beats_per_bar: 4 })
    expect(() => renderCatalog(sources, [id])).not.toThrow()
    const changed = {
      ...sources,
      golden: (other: string) => (other === id ? edit(sources.golden(id)) : sources.golden(other))
    }
    expect(() => renderCatalog(changed, [id])).toThrow(error)
  })

  test('keeps a title with an apostrophe', () => {
    const { data } = renderCatalog(sources, ['teddy-bears-picnic'])
    expect(JSON.parse(data.text)[0].title).toBe("The Teddy Bears' Picnic")
  })

  // A new deploy's catalog has a new name, so no browser or cache reads an older one for it.
  test('names the catalog by its content', () => {
    const one = renderCatalog(sources, ['twinkle', 'mary'])
    const again = renderCatalog(sources, ['twinkle', 'mary'])
    const other = renderCatalog(sources, ['mary', 'twinkle'])
    expect(one.data.path).toMatch(/^public\/catalog\/songs-[0-9a-f]{16}\.json$/)
    expect(again.data.path).toBe(one.data.path)
    expect(other.data.path).not.toBe(one.data.path)
    expect(one.path.text).toContain(`'${one.data.path.slice('public'.length)}'`)
  })

  // A Song's notes keep their name while they stay the same, so a browser keeps them for offline
  // use across deploys, and get a new one, and the index with it, once they change.
  test("names each Song's notes by their content", () => {
    const one = renderCatalog(sources, ['twinkle', 'mary'])
    expect(renderCatalog(sources, ['mary']).notes[0].path).toBe(one.notes[1].path)
    const changed = {
      ...sources,
      golden: (id: string) => {
        const golden = sources.golden(id)
        return id !== 'mary' ? golden : { ...golden, length_beats: golden.length_beats + 1 }
      }
    }
    const other = renderCatalog(changed, ['twinkle', 'mary'])
    expect(other.notes[0].path).toBe(one.notes[0].path)
    expect(other.notes[1].path).not.toBe(one.notes[1].path)
    expect(other.data.path).not.toBe(one.data.path)
  })

  test('finds a Song by the other titles in tools/catalog/, once each', () => {
    const named = (titles: string) =>
      catalogSongs({ ...sources, titles: [titles] }, ['danny-boy'])[0].aliases
    expect(named('danny-boy | Danny Boy | Londonderry Air; Danny boy; londonderry')).toEqual([
      'Londonderry Air'
    ])
    expect(named('# danny-boy | Danny Boy | Londonderry Air')).toBeUndefined()
    expect(titleNames(['a | A | B; C # a comment', '', 'a | A | D'])).toEqual(
      new Map([['a', ['A', 'B', 'C', 'A', 'D']]])
    )
  })

  // `/compose/pad/` is the Sound Pad, and `/compose/song/` answers for every Song offline.
  test.each(['pad', 'song'])("refuses a Song whose id is Compose's own page %s", id => {
    const twinkle = sources.catalog.find(e => e.id === 'twinkle') as CatalogEntry
    const taken = {
      catalog: [{ ...twinkle, id }],
      golden: () => ({ ...sources.golden('twinkle'), id }),
      titles: []
    }
    expect(() => catalogSongs(taken, [id])).toThrow(/Compose's own pages/)
  })

  test('refuses a source it has no line for', () => {
    expect(() => renderCatalog(sources, ['ode-mutopia'])).toThrow(/no line for/)
  })

  const twinkle = sources.catalog.find(e => e.id === 'twinkle') as CatalogEntry
  const withSource = (source: Record<string, string>) => ({
    ...sources,
    catalog: [{ ...twinkle, source }]
  })

  // #356 shows a Song's composer under its title and searches by it. #357's lookup is its only
  // source: the name a PDMX score gives (`source.composer`) is often a lyricist, a page or "NA".
  test('shows #357’s composer, never the one the score names', () => {
    const entries = new Map(sources.catalog.map(e => [e.id, e]))
    // Songs whose score names someone, but #357 found no page that does.
    const scoreOnly = songs.filter(s => {
      const entry = entries.get(s.id) as CatalogEntry
      return entry.composer === 'Unknown' && (entry.source.composer ?? '').trim() !== ''
    })
    expect(scoreOnly.length).toBeGreaterThan(0)
    expect(scoreOnly.filter(s => 'composer' in s)).toEqual([])
    // And a Song not looked up yet, as every Song was before #357.
    const salut = sources.catalog.find(e => e.id === 'salut-damour') as CatalogEntry
    const { composer: _, composer_died: _died, composer_source: _source, ...unlooked } = salut
    const [notLookedUp] = catalogSongs({ ...sources, catalog: [unlooked] }, ['salut-damour'])
    expect(unlooked.source.composer).toMatch(/Elgar/)
    expect('composer' in notLookedUp).toBe(false)
    // Its score says "Composed by Eward Elgar Arranged by Alien".
    expect(songs.find(s => s.id === 'salut-damour')?.composer).toBe('Edward Elgar')
  })

  test('carries each score’s MuseScore views and rating, and the melody’s length', () => {
    const [star, mary] = catalogSongs(sources, ['twinkle', 'mary'])
    expect(star).toMatchObject({ views: 4171, rating: 4.59, lengthBeats: 32 })
    // Mary's score has no ratings, so no rating.
    expect(mary).toMatchObject({ views: 51, lengthBeats: 16 })
    expect('rating' in mary).toBe(false)
    expect(songs.filter(s => s.lengthBeats !== s.length_beats)).toEqual([])
  })

  test('refuses a Song whose score has no MuseScore views', () => {
    const { n_views, ...source } = twinkle.source
    expect(n_views).toBe('4171')
    expect(() => catalogSongs(withSource(source), ['twinkle'])).toThrow(/n_views/)
  })
})
