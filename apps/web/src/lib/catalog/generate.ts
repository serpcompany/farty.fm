import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { searchKey } from './search-key'
import type { Song, SongNotes, SongSummary } from './song'

export type CatalogEntry = {
  id: string
  title: string
  file: string
  sha256: string
  source: Record<string, string>
  render: Render
}

type Render = {
  bpm: number
  max_beats?: number
  beats_per_bar?: number
  start_beat?: number
}

export type GoldenSong = {
  id: string
  title: string
  file: string
  sha256: string
  import_args: Render
  bpm: number
  beats_per_bar: number
  bar_lines: number[]
  length_beats: number
  pitches: number[]
  notes: { start: number; dur: number; pitch: number }[]
}

export type Sources = {
  catalog: CatalogEntry[]
  golden(id: string): GoldenSong
  titles: readonly string[]
}

export type GeneratedFile = { path: string; text: string }

export type CatalogFiles = {
  data: GeneratedFile
  notes: GeneratedFile[]
  path: GeneratedFile
  index: GeneratedFile
  songs: GeneratedFile
}

const repo = new URL('../../../../../', import.meta.url)
const web = new URL('../../../', import.meta.url)
const dataDirectory = 'public/catalog'
const notesDirectory = `${dataDirectory}/notes`
const dataFile = /^songs-[0-9a-f]+\.json$/
const notesFile = /^[a-z0-9-]+-[0-9a-f]{16}\.json$/
const titlesFile = /^titles-\d+\.txt$/

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, repo)), 'utf8')) as T
}

const iPhoneSongs: readonly string[] = [
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
]

const notShipped: readonly string[] = ['ode-mutopia']

export function shippedIds(catalog: readonly CatalogEntry[]): string[] {
  const rest = catalog
    .map(e => e.id)
    .filter(id => !iPhoneSongs.includes(id) && !notShipped.includes(id))
  return [...iPhoneSongs, ...rest]
}

const reservedIds: readonly string[] = ['pad', 'song']

export function readSources(): Sources {
  const tools = fileURLToPath(new URL('tools/catalog/', repo))
  return {
    catalog: readJson<CatalogEntry[]>('catalog/catalog.json'),
    golden: id => readJson<GoldenSong>(`fixtures/golden/songs/${id}.json`),
    titles: readdirSync(tools)
      .filter(name => titlesFile.test(name))
      .sort()
      .map(name => readFileSync(`${tools}${name}`, 'utf8'))
  }
}

export function titleNames(titles: readonly string[]): Map<string, string[]> {
  const names = new Map<string, string[]>()
  for (const text of titles) {
    for (const line of text.split('\n')) {
      const parts = line
        .split('#', 1)[0]
        .split('|')
        .map(part => part.trim())
      if (parts.length < 2 || !parts[0]) continue
      const others = (parts[2] ?? '').split(';').map(name => name.trim())
      names.set(parts[0], [...(names.get(parts[0]) ?? []), parts[1], ...others].filter(Boolean))
    }
  }
  return names
}

function aliasesOf(title: string, names: readonly string[]): string[] {
  const keys = [searchKey(title)]
  const aliases: string[] = []
  for (const name of names) {
    const key = searchKey(name)
    if (key === '' || keys.some(k => k.includes(key))) continue
    keys.push(key)
    aliases.push(name)
  }
  return aliases
}

function sourceLine(entry: CatalogEntry): string {
  const { dataset = '', license } = entry.source
  if (dataset.startsWith('PDMX') && (license === 'publicdomain' || license === 'cc-zero'))
    return 'Public domain score · PDMX'
  throw new Error(`Song ${entry.id} has a source this script has no line for; add one here`)
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function notesFor(id: string, notes: SongNotes): GeneratedFile {
  const text = `${JSON.stringify(notes)}\n`
  return { path: `${notesDirectory}/${id}-${hash(text)}.json`, text }
}

const served = (path: string) => path.slice('public'.length)

function song(entry: CatalogEntry, golden: GoldenSong, names: readonly string[]): Song {
  const problem = (what: string) => new Error(`Song ${entry.id}: ${what}`)
  if (reservedIds.includes(entry.id)) throw problem("its id is one of Compose's own pages")
  if (golden.id !== entry.id || golden.title !== entry.title)
    throw problem('the golden copy has another id or title')
  if (golden.file !== entry.file || golden.sha256 !== entry.sha256)
    throw problem("the golden copy wasn't imported from the cited score")
  if (golden.bpm !== entry.render.bpm) throw problem('the golden copy has another tempo')
  const renderKeys = ['bpm', 'max_beats', 'beats_per_bar', 'start_beat'] as const
  if (renderKeys.some(key => golden.import_args?.[key] !== entry.render[key]))
    throw problem("the golden copy wasn't imported with the catalog's render arguments")
  const { max_beats, beats_per_bar } = entry.render
  if (beats_per_bar !== undefined && golden.beats_per_bar !== beats_per_bar)
    throw problem('the golden copy has another meter')
  const { notes } = golden
  if (notes.length === 0) throw problem('no notes')
  if (max_beats !== undefined && notes.some(n => n.start >= max_beats))
    throw problem(`the golden copy has a note on or after beat ${max_beats}`)
  for (const [i, note] of notes.entries()) {
    if (!(note.dur > 0) || (i > 0 && note.start < notes[i - 1].start))
      throw problem(`note ${i} isn't in time order with a positive length`)
  }
  const pitches = [...new Set(notes.map(n => n.pitch))].sort((a, b) => a - b)
  if (pitches.join() !== golden.pitches.join()) throw problem("its pitches don't match its notes")

  const melody: SongNotes = {
    bar_lines: golden.bar_lines,
    length_beats: golden.length_beats,
    notes: notes.map(({ start, dur, pitch }) => ({ start, dur, pitch }))
  }
  const aliases = aliasesOf(entry.title, names)
  return {
    id: entry.id,
    title: entry.title,
    ...(aliases.length > 0 && { aliases }),
    source: sourceLine(entry),
    bpm: golden.bpm,
    pitches,
    durations: pitches.map(p => notes.filter(n => n.pitch === p).map(n => n.dur)),
    notesPath: served(notesFor(entry.id, melody).path),
    ...melody
  }
}

function summary(song: Song): SongSummary {
  const { bar_lines, length_beats, notes, ...rest } = song
  return rest
}

export function catalogSongs(
  sources: Sources,
  ids: readonly string[] = shippedIds(sources.catalog)
): Song[] {
  if (new Set(ids).size !== ids.length) throw new Error('the Songs to ship name a Song twice')
  const names = titleNames(sources.titles)
  const entries = new Map(sources.catalog.map(e => [e.id, e]))
  return ids.map(id => {
    const entry = entries.get(id)
    if (!entry) throw new Error(`${id} isn't in catalog/catalog.json`)
    return song(entry, sources.golden(id), names.get(id) ?? [])
  })
}

const header = [
  '// Generated by src/lib/catalog/generate.ts from catalog/catalog.json, fixtures/golden/songs/',
  '// and tools/catalog/titles-*.txt. Do not edit by hand: run it again instead.'
]

export function renderCatalog(
  sources: Sources,
  ids: readonly string[] = shippedIds(sources.catalog)
): CatalogFiles {
  const songs = catalogSongs(sources, ids)
  const data = `[\n${songs.map(s => JSON.stringify(summary(s))).join(',\n')}\n]\n`
  const file = `${dataDirectory}/songs-${hash(data)}.json`
  const notes = songs.map(({ id, bar_lines, length_beats, notes }) =>
    notesFor(id, { bar_lines, length_beats, notes })
  )
  return {
    data: { path: file, text: data },
    notes,
    path: {
      path: 'src/lib/catalog/catalog-path.generated.ts',
      text: [
        ...header,
        '',
        `/** Where the browser fetches the Song Catalog's index: ${songs.length} Songs, named by their content. */`,
        `export const catalogPath = '${served(file)}'`,
        ''
      ].join('\n')
    },
    index: {
      path: 'src/lib/catalog/song-index.generated.ts',
      text: [
        ...header,
        `import index from '../../../${file}'`,
        "import type { SongSummary } from './song'",
        '',
        '/**',
        " * The Song Catalog's index, in the app's order, for routes and the server. The browser",
        ' * fetches it instead (`load-songs.ts`), so it stays out of the JavaScript (#322).',
        ' */',
        'export const songIndex: readonly SongSummary[] = index',
        ''
      ].join('\n')
    },
    songs: {
      path: 'src/test-support/songs.generated.ts',
      text: [
        ...header,
        `import index from '../../${file}'`,
        ...notes.map((n, i) => `import notes${i} from '../../${n.path}'`),
        "import type { Song, SongSummary } from '../lib/catalog/song'",
        '',
        'const notes = [',
        ...notes.map((_, i) => `  notes${i}${i < notes.length - 1 ? ',' : ''}`),
        ']',
        '',
        '/**',
        " * The Songs the app ships, with their notes, in the app's order, for the tests. The",
        " * browser fetches the index and each Song's notes instead (`load-songs.ts`, #322, #323).",
        ' */',
        'export const songs: readonly Song[] = (index as readonly SongSummary[]).map((song, i) => ({',
        '  ...song,',
        '  ...notes[i]',
        '}))',
        ''
      ].join('\n')
    }
  }
}

const inWeb = (path: string) => fileURLToPath(new URL(path, web))

function filesIn(directory: string, pattern: RegExp): string[] {
  try {
    return readdirSync(inWeb(directory))
      .filter(name => pattern.test(name))
      .map(name => `${directory}/${name}`)
  } catch {
    return []
  }
}

function written(files: CatalogFiles): GeneratedFile[] {
  return [files.data, ...files.notes, files.path, files.index, files.songs]
}

function staleFiles(files: CatalogFiles): string[] {
  const paths = new Set(written(files).map(f => f.path))
  return [...filesIn(dataDirectory, dataFile), ...filesIn(notesDirectory, notesFile)].filter(
    path => !paths.has(path)
  )
}

export function outOfDate(files: CatalogFiles): string[] {
  const stale: string[] = []
  for (const { path, text } of written(files)) {
    let current: string | null = null
    try {
      current = readFileSync(inWeb(path), 'utf8')
    } catch {}
    if (current !== text) stale.push(path)
  }
  return [...stale, ...staleFiles(files)]
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
    console.log('ok    the catalog matches catalog/, fixtures/golden/songs/ and the titles files')
    return
  }
  mkdirSync(inWeb(notesDirectory), { recursive: true })
  for (const path of staleFiles(files)) rmSync(inWeb(path))
  for (const { path, text } of written(files)) writeFileSync(inWeb(path), text)
  console.log(
    `wrote ${files.data.path}, ${files.notes.length} Songs' notes and their three modules`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
