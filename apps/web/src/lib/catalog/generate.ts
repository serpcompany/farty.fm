/**
 * Generates the Song Catalog the app ships from what the reference engine already imported, as the
 * iPhone app's `ios/scripts/generate-sample-data.py` does (ADR 0003):
 *
 * - each Song's melody from `fixtures/golden/songs/<id>.json`, so nothing parses MIDI here;
 * - its title and source line from `catalog/catalog.json`, checked against the golden copy, so
 *   the notes come from the cited score;
 * - only the Songs on the ship list, in its order.
 *
 * It writes the Songs as data, not code (#322), so the JavaScript bundle stays the same size
 * however many Songs ship:
 *
 * - `public/catalog/songs-<hash>.json`, named by its content, which the browser fetches
 *   (`load-songs.ts`) and the service worker keeps. A new deploy's code names its own file, so it
 *   never reads an older catalog. The older file is deleted.
 * - `catalog-path.generated.ts`, that file's path, for the browser.
 * - `songs.generated.ts`, which imports the file, for the server and the tests.
 *
 * Node-only: the app imports the generated files, never this one. Run from `apps/web/`:
 *
 *     pnpm exec tsx src/lib/catalog/generate.ts           # rewrite the catalog
 *     pnpm exec tsx src/lib/catalog/generate.ts --check   # fail if it's out of date
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Song } from './song'

/** An entry of `catalog/catalog.json`: the cited score and how the reference engine imports it. */
export type CatalogEntry = {
  id: string
  title: string
  file: string
  sha256: string
  source: Record<string, string>
  render: { bpm: number }
}

/** `fixtures/golden/songs/<id>.json`: the reference engine's import of a catalog score. */
export type GoldenSong = {
  id: string
  title: string
  file: string
  sha256: string
  bpm: number
  /** Where the score's bars start, in beats: a note on one is accented. A pickup isn't a bar. */
  bar_lines: number[]
  length_beats: number
  pitches: number[]
  notes: { start: number; dur: number; pitch: number }[]
}

export type Sources = { catalog: CatalogEntry[]; golden(id: string): GoldenSong }

/** What the generator writes: each file's path from `apps/web/`, and its text. */
export type CatalogFiles = {
  /** `public/catalog/songs-<hash>.json`. */
  data: { path: string; text: string }
  /** `src/lib/catalog/catalog-path.generated.ts`. */
  path: { path: string; text: string }
  /** `src/lib/catalog/songs.generated.ts`. */
  songs: { path: string; text: string }
}

const repo = new URL('../../../../../', import.meta.url)
const web = new URL('../../../', import.meta.url)
/** Where the catalog's data file goes, served at `/catalog/`. */
export const dataDirectory = 'public/catalog'
const dataFile = /^songs-[0-9a-f]+\.json$/

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, repo)), 'utf8')) as T
}

/**
 * The Songs the app ships, from `ship-list.json`: the iPhone app's 12 in its order, then the rest
 * of the catalog in its order (#229). A Song added to `catalog/` doesn't ship until it's on this
 * list. The Mutopia Ode to Joy (`ode-mutopia`) stays
 * out: it's the same tune as `ode`, kept in the catalog to exercise the reference engine's
 * importer. `tools/melody-lab/export_golden.py` reads the same file, so every Song on it has
 * golden data.
 */
export const shipList: readonly string[] = readJson<string[]>(
  'apps/web/src/lib/catalog/ship-list.json'
)

/**
 * Compose's own pages beside the Songs' `/compose/<id>/`: the Sound Pad, and the Song page the
 * service worker answers with offline (`app/compose/song/`). No Song may take their ids.
 */
export const reservedIds: readonly string[] = ['pad', 'song']

/** The catalog and the golden Songs, read from the repository. */
export function readSources(): Sources {
  return {
    catalog: readJson<CatalogEntry[]>('catalog/catalog.json'),
    golden: id => readJson<GoldenSong>(`fixtures/golden/songs/${id}.json`)
  }
}

/**
 * The line each Song shows under its title, from its source and license. CC0 is a public domain
 * dedication, so a CC0 score's line is a public domain score's.
 */
function sourceLine(entry: CatalogEntry): string {
  const { dataset = '', license } = entry.source
  if (dataset.startsWith('PDMX') && (license === 'publicdomain' || license === 'cc-zero'))
    return 'Public domain score · PDMX'
  throw new Error(`Song ${entry.id} has a source this script has no line for; add one here`)
}

function song(entry: CatalogEntry, golden: GoldenSong): Song {
  const problem = (what: string) => new Error(`Song ${entry.id}: ${what}`)
  if (reservedIds.includes(entry.id)) throw problem("its id is one of Compose's own pages")
  if (golden.id !== entry.id || golden.title !== entry.title)
    throw problem('the golden copy has another id or title')
  if (golden.file !== entry.file || golden.sha256 !== entry.sha256)
    throw problem("the golden copy wasn't imported from the cited score")
  if (golden.bpm !== entry.render.bpm) throw problem('the golden copy has another tempo')
  const { notes } = golden
  if (notes.length === 0) throw problem('no notes')
  for (const [i, note] of notes.entries()) {
    if (!(note.dur > 0) || (i > 0 && note.start < notes[i - 1].start))
      throw problem(`note ${i} isn't in time order with a positive length`)
  }
  const pitches = [...new Set(notes.map(n => n.pitch))].sort((a, b) => a - b)
  if (pitches.join() !== golden.pitches.join()) throw problem("its pitches don't match its notes")

  return {
    id: entry.id,
    title: entry.title,
    source: sourceLine(entry),
    bpm: golden.bpm,
    bar_lines: golden.bar_lines,
    length_beats: golden.length_beats,
    pitches,
    notes: notes.map(({ start, dur, pitch }) => ({ start, dur, pitch }))
  }
}

/** The Songs on `ids`, from the catalog and the golden data, checked. */
export function catalogSongs(sources: Sources, ids: readonly string[] = shipList): Song[] {
  if (new Set(ids).size !== ids.length) throw new Error('the ship list names a Song twice')
  return ids.map(id => {
    const entry = sources.catalog.find(e => e.id === id)
    if (!entry) throw new Error(`the ship list names ${id}, which isn't in catalog/catalog.json`)
    return song(entry, sources.golden(id))
  })
}

const header = [
  '// Generated by src/lib/catalog/generate.ts from catalog/catalog.json and',
  '// fixtures/golden/songs/. Do not edit by hand: run it again instead.'
]

/** The files the generator writes for the Songs on `ids`. */
export function renderCatalog(sources: Sources, ids: readonly string[] = shipList): CatalogFiles {
  const songs = catalogSongs(sources, ids)
  // One Song a line, so a change shows as the Songs it changed.
  const data = `[\n${songs.map(s => JSON.stringify(s)).join(',\n')}\n]\n`
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16)
  const file = `songs-${hash}.json`
  return {
    data: { path: `${dataDirectory}/${file}`, text: data },
    path: {
      path: 'src/lib/catalog/catalog-path.generated.ts',
      text: [
        ...header,
        '',
        `/** Where the browser fetches the Song Catalog: ${songs.length} Songs, named by their content. */`,
        `export const catalogPath = '/catalog/${file}'`,
        ''
      ].join('\n')
    },
    songs: {
      path: 'src/lib/catalog/songs.generated.ts',
      text: [
        ...header,
        `import catalog from '../../../${dataDirectory}/${file}'`,
        "import type { Song } from './song'",
        '',
        '/**',
        " * The Songs the app ships, in the ship list's order, for the server and the tests. The browser",
        ' * fetches them instead (`load-songs.ts`), so they stay out of its JavaScript (#322).',
        ' */',
        'export const songs: readonly Song[] = catalog',
        ''
      ].join('\n')
    }
  }
}

const inWeb = (path: string) => fileURLToPath(new URL(path, web))

/** The data files in `public/catalog/` now, by name. */
function dataFiles(): string[] {
  try {
    return readdirSync(inWeb(dataDirectory)).filter(name => dataFile.test(name))
  } catch {
    return []
  }
}

/** What differs between the files on disk and `files`: none when the catalog is current. */
export function outOfDate(files: CatalogFiles): string[] {
  const stale: string[] = []
  for (const { path, text } of [files.data, files.path, files.songs]) {
    let current: string | null = null
    try {
      current = readFileSync(inWeb(path), 'utf8')
    } catch {
      // Missing: out of date.
    }
    if (current !== text) stale.push(path)
  }
  const name = files.data.path.slice(dataDirectory.length + 1)
  for (const other of dataFiles()) if (other !== name) stale.push(`${dataDirectory}/${other}`)
  return stale
}

function main(): void {
  const files = renderCatalog(readSources())
  if (process.argv.includes('--check')) {
    const stale = outOfDate(files)
    if (stale.length > 0) {
      console.error(
        `error: the catalog is out of date (${stale.join(', ')}); run pnpm exec tsx src/lib/catalog/generate.ts`
      )
      process.exit(1)
    }
    console.log('ok    the catalog matches catalog/ and fixtures/golden/songs/')
    return
  }
  mkdirSync(inWeb(dataDirectory), { recursive: true })
  const name = files.data.path.slice(dataDirectory.length + 1)
  for (const other of dataFiles()) if (other !== name) rmSync(inWeb(`${dataDirectory}/${other}`))
  for (const { path, text } of [files.data, files.path, files.songs])
    writeFileSync(inWeb(path), text)
  console.log(`wrote ${files.data.path} (${shipList.length} Songs) and its two modules`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
