import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// The piano is the one sound that isn't a fart, and it goes straight to the speakers (ADR 0015
// rule 3, #359): no render, Toot, share or saved file may hold it. So nothing that makes, saves or
// serves audio may import the piano's code, even through another module.

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = join(APP, 'src')

/** The piano's code: its voice and the melody it plays. */
const PIANO = ['src/components/pedos/piano-keys.tsx', 'src/components/pedos/piano-preview.ts']

/**
 * What makes, saves or serves audio: everything in `src/lib/` (the renderer and its worker,
 * Toots, Recordings, their stores and sync, the Sound Pad), the server, every route (the library's
 * and shares' audio among them), and the scripts that render Songs.
 */
const ENTRIES = [
  ...files('src/lib'),
  ...files('src/server'),
  ...files('src/app').filter(file => /\/route\.tsx?$/.test(file)),
  ...files('scripts')
]

function files(dir: string): string[] {
  const out: string[] = []
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
    }
  }
  walk(join(APP, dir))
  return out
}

/** Every module `file` imports, statically, dynamically, or as a Worker's script. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const specifiers = [
    ...source.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g)
  ].map(match => match[1])
  return specifiers.flatMap(specifier => {
    const base = specifier.startsWith('@/')
      ? join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(file), specifier)
        : null
    if (base === null) return []
    const found = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map(extension => base + extension)
      .find(path => existsSync(path) && statSync(path).isFile())
    return found ? [found] : []
  })
}

/** The import chain from an entry to the piano's code, or null when none reaches it. */
function chainToPiano(entry: string): string[] | null {
  const piano = new Set(PIANO.map(path => join(APP, path)))
  const from = new Map<string, string | null>([[entry, null]])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (piano.has(file)) {
      const chain: string[] = []
      for (let at: string | null = file; at !== null; at = from.get(at) ?? null) {
        chain.unshift(relative(APP, at))
      }
      return chain
    }
    for (const next of importsOf(file)) {
      if (from.has(next)) continue
      from.set(next, file)
      queue.push(next)
    }
  }
  return null
}

describe('the piano stays out of every render, Toot, share and saved file', () => {
  test('there is something to check', () => {
    expect(ENTRIES.length).toBeGreaterThan(50)
    expect(ENTRIES.map(file => relative(APP, file))).toEqual(
      expect.arrayContaining([
        'src/lib/engine/renderer.ts',
        'src/lib/engine/worker.ts',
        'src/lib/toot-renderer.ts',
        'src/lib/toot-store.ts',
        'scripts/render-songs.ts'
      ])
    )
  })

  test('no module that makes, saves or serves audio imports the piano', () => {
    const reached = ENTRIES.map(chainToPiano).filter(chain => chain !== null)
    expect(reached).toEqual([])
  })

  test('the walk finds the piano where it is imported', () => {
    const songCreator = join(SRC, 'components/pedos/song-creator.tsx')
    expect(chainToPiano(songCreator)?.at(-1)).toMatch(/piano-(keys|preview)/)
  })

  test('nothing makes a tone with an oscillator: the piano is samples built in code', () => {
    const tones = [...files('src'), ...files('scripts')]
      .filter(file => /createOscillator|OscillatorNode/.test(readFileSync(file, 'utf8')))
      .map(file => relative(APP, file))
    expect(tones).toEqual([])
  })
})
