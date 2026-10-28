/**
 * Generates the Songs the app ships (`songs.generated.ts`) from what the reference engine already
 * imported, as the iPhone app's `ios/scripts/generate-sample-data.py` does (ADR 0003):
 *
 * - each Song's melody from `fixtures/golden/songs/<id>.json`, so nothing parses MIDI here;
 * - its title and source line from `catalog/catalog.json`, checked against the golden copy, so
 *   the notes come from the cited score;
 * - only the Songs on the ship list, in its order.
 *
 * Node-only: the app imports `songs.generated.ts`, never this file. Run from `apps/web/`:
 *
 *     pnpm exec tsx src/lib/catalog/generate.ts           # rewrite songs.generated.ts
 *     pnpm exec tsx src/lib/catalog/generate.ts --check   # fail if it's out of date
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const repo = new URL('../../../../../', import.meta.url)
export const outputPath = fileURLToPath(new URL('songs.generated.ts', import.meta.url))

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, repo)), 'utf8')) as T
}

/**
 * The Songs the app ships, in the iPhone app's order, from `ship-list.json`. A Song added to
 * `catalog/` doesn't ship until it's on this list. The Mutopia Ode to Joy (`ode-mutopia`) stays
 * out: it's the same tune as `ode`, kept in the catalog to exercise the reference engine's
 * importer. `tools/melody-lab/export_golden.py` reads the same file, so every Song on it has
 * golden data.
 */
export const shipList: readonly string[] = readJson<string[]>(
  'apps/web/src/lib/catalog/ship-list.json'
)

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

function quoted(text: string): string {
  if (/['\\\n]/.test(text)) throw new Error(`can't quote ${JSON.stringify(text)}`)
  return `'${text}'`
}

function song(entry: CatalogEntry, golden: GoldenSong): string[] {
  const problem = (what: string) => new Error(`Song ${entry.id}: ${what}`)
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

  return [
    '  {',
    `    id: ${quoted(entry.id)},`,
    `    title: ${quoted(entry.title)},`,
    `    source: ${quoted(sourceLine(entry))},`,
    `    bpm: ${golden.bpm},`,
    `    bar_lines: [${golden.bar_lines.join(', ')}],`,
    `    length_beats: ${golden.length_beats},`,
    `    pitches: [${pitches.join(', ')}],`,
    '    notes: [',
    ...notes.map(
      (n, i) =>
        `      { start: ${n.start}, dur: ${n.dur}, pitch: ${n.pitch} }${i < notes.length - 1 ? ',' : ''}`
    ),
    '    ]',
    '  }'
  ]
}

/** The text of `songs.generated.ts` for the Songs on `ids`. */
export function renderCatalog(sources: Sources, ids: readonly string[] = shipList): string {
  if (new Set(ids).size !== ids.length) throw new Error('the ship list names a Song twice')
  const songs = ids.map(id => {
    const entry = sources.catalog.find(e => e.id === id)
    if (!entry) throw new Error(`the ship list names ${id}, which isn't in catalog/catalog.json`)
    return song(entry, sources.golden(id))
  })
  return [
    '// Generated by src/lib/catalog/generate.ts from catalog/catalog.json and',
    '// fixtures/golden/songs/. Do not edit by hand: run it again instead.',
    "import type { Song } from './song'",
    '',
    "/** The Songs the app ships, in the ship list's order. */",
    'export const songs: readonly Song[] = [',
    ...songs.flatMap((lines, i) =>
      i < songs.length - 1 ? [...lines.slice(0, -1), '  },'] : lines
    ),
    ']',
    ''
  ].join('\n')
}

function main(): void {
  const text = renderCatalog(readSources())
  if (process.argv.includes('--check')) {
    if (readFileSync(outputPath, 'utf8') !== text) {
      console.error(
        'error: songs.generated.ts is out of date; run pnpm exec tsx src/lib/catalog/generate.ts'
      )
      process.exit(1)
    }
    console.log('ok    songs.generated.ts matches catalog/ and fixtures/golden/songs/')
    return
  }
  writeFileSync(outputPath, text)
  console.log(`wrote songs.generated.ts (${shipList.length} Songs)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
