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
 * The functions that make or save audio: render a Song or a Sound Pad take, encode a file, or keep
 * one in this browser, the account or a share. A module outside `src/lib/` that calls one of them
 * makes or saves Toots (or Recordings), so it is checked like `src/lib/` itself.
 */
const MAKES_OR_SAVES: Record<string, string[]> = {
  'src/lib/engine/client.ts': ['renderInWorker', 'renderPerformanceInWorker', 'padSoundInWorker'],
  'src/lib/engine/render-song.ts': ['renderSong', 'renderFromRecordings'],
  'src/lib/engine/renderer.ts': ['render'],
  'src/lib/engine/render-performance.ts': ['renderPerformance'],
  'src/lib/toot-renderer.ts': ['makeToot', 'makePadToot'],
  'src/lib/toot-store.ts': ['saveToot'],
  'src/lib/recording-store.ts': ['saveRecording'],
  'src/lib/audio/recorder.ts': ['startTake'],
  'src/lib/wav.ts': ['encodeWav'],
  'src/lib/library-api.ts': ['putItem', 'setFartChoices'],
  // A Song's Fart Choices (#360): what its Toot is made again from after a swap or leave-out.
  'src/lib/fart-choice-store.ts': ['setFartChoices'],
  'src/lib/library-sync.ts': ['startSync', 'syncOnce', 'uploadBeforeSignOut', 'claimLibrary'],
  'src/lib/sharing.ts': ['shareItem'],
  'src/lib/pad-take.ts': ['keepTake', 'keepForCheckout']
}

/**
 * What makes, saves or serves audio: everything in `src/lib/` (the renderer and its worker,
 * Toots, Recordings, their stores and sync, the Sound Pad), the server, every route (the library's
 * and shares' audio among them), the scripts that render Songs, and every other module that calls
 * a function in `MAKES_OR_SAVES` or constructs an `OfflineAudioContext` (the provider that makes
 * and saves Toots among them). Found by reading the source, so a new one is checked without a list.
 */
const ENTRIES = unique([
  ...files('src/lib'),
  ...files('src/server'),
  ...files('src/app').filter(file => /\/route\.tsx?$/.test(file)),
  ...files('scripts'),
  ...files('src').filter(
    file => !/^src\/(lib|server)\//.test(relative(APP, file)) && makesOrSaves(file)
  )
])

function unique(paths: string[]): string[] {
  return [...new Set(paths)]
}

/** Whether `file` calls a function that makes or saves audio, or makes an offline context. */
function makesOrSaves(file: string): boolean {
  const source = readFileSync(file, 'utf8')
  if (/\bnew\s+OfflineAudioContext\b/.test(source)) return true
  return importClauses(file).some(({ module, clause }) => {
    const names = MAKES_OR_SAVES[relative(APP, module)]
    if (!names || /^type\b/.test(clause)) return false
    // `import * as store from …` then `store.saveRecording(…)`.
    const namespace = clause.match(/\*\s*as\s+(\w+)/)?.[1]
    if (namespace) {
      const used = [...source.matchAll(new RegExp(`\\b${namespace}\\s*\\.\\s*(\\w+)`, 'g'))]
      return used.some(match => names.includes(match[1]))
    }
    // `import { makeToot as renderToot, type Toot } from …`: the names before any `as`.
    const imported = (clause.match(/\{([^}]*)\}/)?.[1] ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(part => part !== '' && !part.startsWith('type '))
      .map(part => part.split(/\s+as\s+/)[0])
    return imported.some(name => names.includes(name))
  })
}

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
  return specifiers.flatMap(specifier => resolved(file, specifier) ?? [])
}

/** Each static `import … from` in `file`: the module it names and what it imports. */
function importClauses(file: string): { module: string; clause: string }[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/\bimport\s+([^'"`;]*?)\s*\bfrom\s*['"]([^'"]+)['"]/g)].flatMap(
    match => {
      const module = resolved(file, match[2])
      return module ? [{ module, clause: match[1] }] : []
    }
  )
}

/** The file an import specifier names, or null for a package. */
function resolved(file: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(file), specifier)
      : null
  if (base === null) return null
  return (
    ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
      .map(extension => base + extension)
      .find(path => existsSync(path) && statSync(path).isFile()) ?? null
  )
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
        'scripts/render-songs.ts',
        // Outside src/lib, found because they make or save Toots or Recordings.
        'src/components/pedos/pedos-provider.tsx',
        'src/components/pedos/pad-take.tsx'
      ])
    )
  })

  test('every function named as making or saving audio is still exported', () => {
    for (const [module, names] of Object.entries(MAKES_OR_SAVES)) {
      const source = readFileSync(join(APP, module), 'utf8')
      for (const name of names) {
        expect(source, `${module} exports ${name}`).toMatch(
          new RegExp(`export (async )?(function|const|class) ${name}\\b`)
        )
      }
    }
  })

  test('a module that only plays or reads audio is not taken for one that saves it', () => {
    const entries = new Set(ENTRIES.map(file => relative(APP, file)))
    // Song Creator plays the piano and reads Recordings, but makes and saves Toots through the
    // provider; the locked sheet only plays the piano.
    expect(entries.has('src/components/pedos/song-creator.tsx')).toBe(false)
    expect(entries.has('src/components/pedos/locked-song-sheet.tsx')).toBe(false)
    // The fart sheet plays a pitch on piano (#373) and changes farts through its parent.
    expect(entries.has('src/components/pedos/fart-sheet.tsx')).toBe(false)
  })

  test("the Toot made again after a change to a Song's farts is checked too (#360)", () => {
    const entries = new Set(ENTRIES.map(file => relative(APP, file)))
    // Song Creator makes the Toot again through the provider, which arranges it with the Song's
    // Fart Choices in `src/lib/`, and keeps the choices through `use-fart-choices`.
    for (const module of [
      'src/components/pedos/pedos-provider.tsx',
      'src/lib/toot-renderer.ts',
      'src/lib/engine/fart-choices.ts',
      'src/lib/fart-sheet.ts',
      'src/lib/fart-choice-store.ts',
      'src/components/pedos/use-fart-choices.ts'
    ]) {
      expect(entries.has(module), module).toBe(true)
      expect(chainToPiano(join(APP, module)), module).toBeNull()
    }
    // Song Creator only asks the provider for the Toot: it renders nothing itself.
    const songCreator = join(SRC, 'components/pedos/song-creator.tsx')
    expect(readFileSync(songCreator, 'utf8')).toMatch(
      /pedos\.makeToot\(song, back\?\.tootId, choices\)/
    )
    expect(makesOrSaves(songCreator)).toBe(false)
  })

  test('no module that makes, saves or serves audio imports the piano', () => {
    const reached = ENTRIES.map(chainToPiano).filter(chain => chain !== null)
    expect(reached).toEqual([])
  })

  test('the walk finds the piano where it is imported', () => {
    const songCreator = join(SRC, 'components/pedos/song-creator.tsx')
    expect(chainToPiano(songCreator)?.at(-1)).toMatch(/piano-(keys|preview)/)
    // The fart sheet's "Hear … on piano" (#373) reaches it through the preview's player.
    const fartSheet = join(SRC, 'components/pedos/fart-sheet.tsx')
    expect(chainToPiano(fartSheet)?.at(-1)).toMatch(/piano-(keys|preview)/)
  })

  test('nothing makes a tone with an oscillator: the piano is samples built in code', () => {
    const tones = [...files('src'), ...files('scripts')]
      .filter(file => /createOscillator|OscillatorNode/.test(readFileSync(file, 'utf8')))
      .map(file => relative(APP, file))
    expect(tones).toEqual([])
  })
})
