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
  composer_source?: string
  published?: number
  checked?: string[]
  remove?: string
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

  // The rules CI can see; tools/catalog/composers.py check has the rest (each name's spelling).
  test('no Song kept is under copyright, and each answer cites a source', () => {
    const broken = lookups
      .filter(isDone)
      .filter(
        l =>
          (l.composer_died ?? 0) > 1955 ||
          (l.published ?? 0) >= 1931 ||
          !isSource(l.composer_source, l.id) ||
          (l.composer === 'Unknown' &&
            !(l.checked?.length && l.checked.every(url => isSource(url, l.id))))
      )
    expect(broken.map(l => `${l.batch}: ${l.id}`)).toEqual([])
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
