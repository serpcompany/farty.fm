import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { type CatalogEntry, outputPath, readSources, renderCatalog } from './generate'
import { songs } from './songs.generated'

const sources = readSources()

describe('the Song Catalog in the app', () => {
  test('is what the generator writes from catalog/ and fixtures/golden/songs/', () => {
    expect(renderCatalog(sources)).toBe(readFileSync(outputPath, 'utf8'))
  })

  test("holds the iPhone app's 12 Songs, in its order", () => {
    expect(songs.map(s => s.id)).toEqual([
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

  test.each(songs)('$id has the golden notes and its cited source', song => {
    const golden = sources.golden(song.id)
    const entry = sources.catalog.find(e => e.id === song.id) as CatalogEntry
    expect(song.notes).toEqual(golden.notes)
    expect([song.bpm, song.beats_per_bar, song.length_beats]).toEqual([
      golden.bpm,
      golden.beats_per_bar,
      golden.length_beats
    ])
    expect(song.pitches).toEqual(golden.pitches)
    expect(song.title).toBe(entry.title)
    expect(song.source).toBe('Public domain score · PDMX')
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

  test('refuses a source it has no line for', () => {
    expect(() => renderCatalog(sources, ['ode-mutopia'])).toThrow(/no line for/)
  })
})
