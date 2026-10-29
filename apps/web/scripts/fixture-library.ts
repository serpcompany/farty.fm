import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FixtureIndex } from '../src/lib/fixture-library'
import { encodeWav } from '../src/lib/wav'
import { decodeFile } from './decode-audio-file'

const APP = fileURLToPath(new URL('..', import.meta.url))
const FIXTURES = join(APP, '../../fixtures/recordings')
const OUT = join(APP, 'public/fixtures/recordings')
const BUILD = join(APP, '.open-next')

const LOADER_TEXT = ['Load the Fixture Library', 'fixtures/recordings/']
const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.aac', '.caf', '.flac', '.ogg'])

export function fixtures(): { id: string; filename: string }[] {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as {
    recordings: { id: string; filename: string }[]
  }
  return manifest.recordings
    .map(({ id, filename }) => ({ id, filename }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function fixtureWav(filename: string): Promise<ArrayBuffer> {
  const { samples, sampleRate } = await decodeFile(join(FIXTURES, filename))
  return encodeWav({ samples, sampleRate })
}

async function copy(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const index: FixtureIndex = { recordings: [] }
  let bytes = 0
  for (const { id, filename } of fixtures()) {
    const wav = await fixtureWav(filename)
    writeFileSync(join(OUT, `${id}.wav`), new Uint8Array(wav))
    index.recordings.push({ id, file: `${id}.wav` })
    bytes += wav.byteLength
  }
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index)}\n`)
  const mb = (bytes / 1e6).toFixed(1)
  console.log(
    `copied ${index.recordings.length} fixtures (${mb} MB) to public/fixtures/recordings/`
  )
}

function remove(): void {
  rmSync(join(APP, 'public/fixtures'), { recursive: true, force: true })
  console.log('removed public/fixtures/')
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

function check(): void {
  if (!existsSync(BUILD)) {
    console.error('error: no .open-next/ build to check; run pnpm build:production first')
    process.exit(1)
  }
  const fixtureFiles = new Map(files(FIXTURES).map(path => [sha256(path), relative(APP, path)]))
  const problems: string[] = []
  for (const path of files(BUILD)) {
    const name = relative(APP, path)
    if (AUDIO.has(extname(path).toLowerCase())) {
      problems.push(`${name}: audio file`)
      continue
    }
    if (/(^|[/\\])fixtures[/\\]/iu.test(relative(BUILD, path))) {
      problems.push(`${name}: under a fixtures/ path`)
      continue
    }
    if (statSync(path).size > 50e6) continue
    const copied = fixtureFiles.get(sha256(path))
    if (copied) problems.push(`${name}: a copy of ${copied}`)
    const text = readFileSync(path, 'latin1')
    for (const needle of LOADER_TEXT) {
      if (text.includes(needle)) problems.push(`${name}: contains "${needle}"`)
    }
  }
  if (problems.length > 0) {
    console.error('error: the build carries the Fixture Library:')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log('ok    the build carries no fixture file, audio or Fixture Library loader')
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'copy') await copy()
  else if (command === 'remove') remove()
  else if (command === 'check') check()
  else {
    console.error('usage: tsx scripts/fixture-library.ts copy|remove|check')
    process.exit(2)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
