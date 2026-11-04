import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../../test-support/golden'
import { type CatalogEntry, catalogSongs, readSources } from './generate'
import { songs } from './songs.generated'

/** A record of `tools/catalog/composers-NN.json`: one Song's composer lookup (#357). */
type Lookup = {
  id: string
  composer?: string
  composer_died?: number
  /** The year the last author died whose words were written with the music. */
  lyricist_died?: number
  composer_source?: string
  published?: number
  checked?: string[]
  remove?: string
  note?: string
}

/** The pages a composer may come from, and the Song's own MuseScore score (tools/catalog/README.md). */
const sourceHosts = [
  'wikipedia.org',
  'imslp.org',
  'thesession.org',
  'tunearch.org',
  'mutopiaproject.org'
]
function isSource(url: string | undefined, id: string): boolean {
  if (url === undefined || !URL.canParse(url)) return false
  const { protocol, hostname, pathname } = new URL(url)
  if (protocol !== 'https:') return false
  if (sourceHosts.some(h => hostname === h || hostname.endsWith(`.${h}`))) return true
  const own = entries.get(id)?.source.musescore_score_id
  return (
    own !== undefined &&
    (hostname === 'musescore.com' || hostname === 'www.musescore.com') &&
    new RegExp(`/scores?/${own}(/|$)`).test(pathname)
  )
}

const sources = readSources()
const tools = `${REPO_ROOT}/tools/catalog`
const batches = readdirSync(tools)
  .filter(name => /^composers-\d+\.json$/.test(name))
  .sort()
  .map(name => ({
    name,
    lookups: JSON.parse(readFileSync(`${tools}/${name}`, 'utf8')) as Lookup[]
  }))
const lookups = batches.flatMap(b => b.lookups.map(lookup => ({ ...lookup, batch: b.name })))
const entries = new Map(sources.catalog.map(e => [e.id, e]))
const isDone = (l: Lookup) => l.composer !== undefined && l.remove === undefined
const fields = (e: Pick<CatalogEntry, 'composer' | 'composer_died' | 'composer_source'>) => ({
  composer: e.composer,
  composer_died: e.composer_died,
  composer_source: e.composer_source
})
const done = sources.catalog.filter(e => e.composer !== undefined && e.composer_source)
const open = lookups.filter(l => !isDone(l) && l.remove === undefined)

/** The copyright limits (ADR 0003), which tools/catalog/composers.py reads too. */
const limits = JSON.parse(readFileSync(`${tools}/copyright.json`, 'utf8')) as {
  first_copyright_year: number
  last_free_death: number
}

/** What keeps a looked-up Song out of the catalog, by tools/catalog/composers.py's rules (ADR 0003):
 * an author who died after `last_free_death` (the composer, or a lyricist whose words were written
 * with the music), a first publication in `first_copyright_year` or later, or a named composer with
 * no death year unless the tune was published before then and a note says why the year is missing. */
function underCopyright(l: Lookup): boolean {
  const named = l.composer !== 'Unknown' && !l.composer?.startsWith('Traditional')
  const oldWithNote =
    l.published !== undefined && l.published < limits.first_copyright_year && !!l.note?.trim()
  return (
    (l.composer_died ?? 0) > limits.last_free_death ||
    (l.lyricist_died ?? 0) > limits.last_free_death ||
    (l.published ?? 0) >= limits.first_copyright_year ||
    (named && l.composer_died === undefined && !oldWithNote)
  )
}

// The count of Songs with a composer can't go down: every Song is in one batch file, a looked-up
// Song carries its batch's answer, and no Song has a composer its batch doesn't give it, so
// losing one means deleting the answer from both its batch file and the catalog.
// tools/catalog/composers.py writes both; tools/catalog/README.md has the procedure.
describe(`the Songs' composers: ${done.length} of ${sources.catalog.length} looked up`, () => {
  test('every Song in the catalog is in one batch of tools/catalog/composers-NN.json', () => {
    const counts = new Map<string, number>()
    for (const l of lookups) counts.set(l.id, (counts.get(l.id) ?? 0) + 1)
    expect(sources.catalog.filter(e => counts.get(e.id) !== 1).map(e => e.id)).toEqual([])
  })

  test('a looked-up Song has its batch’s composer, death year and source', () => {
    const differ = lookups
      .filter(l => isDone(l) && entries.has(l.id))
      .filter(l => {
        const entry = entries.get(l.id) as CatalogEntry
        return JSON.stringify(fields(entry)) !== JSON.stringify(fields(l))
      })
    expect(differ.map(l => `${l.batch}: ${l.id}`)).toEqual([])
  })

  test('a Song its batch removes as under copyright is gone from the catalog', () => {
    expect(lookups.filter(l => l.remove !== undefined && entries.has(l.id)).map(l => l.id)).toEqual(
      []
    )
  })

  test("no Song has a composer its batch doesn't give it", () => {
    const given = new Set(lookups.filter(isDone).map(l => l.id))
    const stray = sources.catalog.filter(
      e => (e.composer !== undefined || e.composer_source !== undefined) && !given.has(e.id)
    )
    expect(stray.map(e => e.id)).toEqual([])
  })

  test('every Song has its composer and source once no lookup is left', () => {
    if (open.length > 0) return
    const missing = sources.catalog.filter(e => !e.composer || !e.composer_source)
    expect(missing.map(e => e.id)).toEqual([])
  })

  // The copyright and source rules; CI also runs tools/catalog/composers.py check, which has the rest
  // (each name's one spelling, a removal's reason, unknown keys).
  test('no Song kept is under copyright, and each answer cites a source', () => {
    const broken = lookups
      .filter(isDone)
      .filter(
        l =>
          underCopyright(l) ||
          !isSource(l.composer_source, l.id) ||
          (l.composer === 'Unknown' &&
            !(l.checked?.length && l.checked.every(url => isSource(url, l.id))))
      )
    expect(broken.map(l => `${l.batch}: ${l.id}`)).toEqual([])
  })

  test.each<[string, Lookup, boolean]>([
    ['a composer who died in 1940', { id: 'x', composer: 'A B', composer_died: 1940 }, false],
    ['a composer who died in 1956', { id: 'x', composer: 'A B', composer_died: 1956 }, true],
    [
      'a lyricist who died in 1970',
      { id: 'x', composer: 'A B', composer_died: 1940, published: 1925, lyricist_died: 1970 },
      true
    ],
    ['a named composer with no death year', { id: 'x', composer: 'A B' }, true],
    ['no death year, published 1925, no note', { id: 'x', composer: 'A B', published: 1925 }, true],
    [
      'no death year, published 1925, with a note',
      { id: 'x', composer: 'A B', published: 1925, note: 'no source gives the year' },
      false
    ],
    ['a folk tune', { id: 'x', composer: 'Traditional (Irish)' }, false]
  ])('%s: under copyright %s', (_, lookup, expected) => {
    expect(underCopyright(lookup)).toBe(expected)
  })

  test('counts the looked-up Songs in the catalog', () => {
    expect(done.length).toBe(lookups.filter(l => isDone(l) && entries.has(l.id)).length)
  })
})

describe("the index's composers", () => {
  test('shows a known composer, and none for an Unknown one or one not looked up', () => {
    for (const song of songs) {
      const { composer } = entries.get(song.id) as CatalogEntry
      expect(song.composer).toBe(composer === 'Unknown' ? undefined : composer)
    }
    expect(songs.find(s => s.id === 'nocturne-op-9-no-2')?.composer).toBe('Frédéric Chopin')
    expect(songs.find(s => s.id === 'irish-washerwoman')?.composer).toBe('Traditional (Irish)')
    expect(songs.find(s => s.id === 'row')).not.toHaveProperty('composer')
  })

  test.each(['NA', '', ' Chopin'])('refuses a composer of %j', composer => {
    const mary = entries.get('mary') as CatalogEntry
    const changed = { ...sources, catalog: [{ ...mary, composer }] }
    expect(() => catalogSongs(changed, ['mary'])).toThrow(/composer/)
  })
})
