import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../../test-support/golden'
import { songPitches } from '../engine/auto-map'
import { catalogPath } from './catalog-path.generated'
import {
  type CatalogEntry,
  catalogSongs,
  outOfDate,
  readSources,
  renderCatalog,
  shipList,
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

  // #229: every Song in catalog/ then, but the second Ode to Joy. Songs added since ship once
  // they're on the ship list.
  test('then the rest of the catalog, in its order, but ode-mutopia', () => {
    const ids = songs.map(s => s.id)
    expect(ids).toHaveLength(128)
    expect(ids).not.toContain('ode-mutopia')
    const catalogOrder = sources.catalog.map(e => e.id).filter(id => ids.slice(12).includes(id))
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

// export_golden.py reads the same ship list (#225), so a Song can't ship without the golden data
// the Auto-map and renderer tests check it against.
describe('the golden data', () => {
  const golden = `${REPO_ROOT}/fixtures/golden`
  const index = JSON.parse(readFileSync(`${golden}/index.json`, 'utf8')) as {
    songs: { id: string }[]
  }

  test.each(shipList)('covers %s, which the app ships', id => {
    expect(index.songs.map(s => s.id)).toContain(id)
    for (const file of [
      `songs/${id}.json`,
      `arrangements/full/${id}.json`,
      `arrangements/small/${id}.json`
    ])
      expect(existsSync(`${golden}/${file}`), file).toBe(true)
  })
})

describe('the generator', () => {
  test('ships only the Songs on the ship list', () => {
    expect(sources.catalog.map(e => e.id)).toContain('ode-mutopia')
    expect(songs.map(s => s.id)).not.toContain('ode-mutopia')
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
})
