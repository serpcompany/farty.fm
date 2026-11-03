import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitIn } from './ci-scope.mjs'

const made: string[] = []

export function scratchHistory() {
  const dir = mkdtempSync(join(tmpdir(), 'farty-ci-'))
  made.push(dir)
  const git = gitIn(dir)
  git(['init', '-q', '-b', 'staging'])
  git(['config', 'user.email', 'ci@farty.fm'])
  git(['config', 'user.name', 'CI'])
  git(['config', 'commit.gpgsign', 'false'])
  let edits = 0
  const committed = (message: string) => {
    git(['add', '-A'])
    git(['commit', '-q', '-m', message])
    return git(['rev-parse', 'HEAD']).trim()
  }
  const commit = (...paths: string[]) => {
    for (const path of paths) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), `edit ${++edits}\n`)
    }
    return committed(paths.join(' '))
  }
  const move = (from: string, to: string) => {
    mkdirSync(dirname(join(dir, to)), { recursive: true })
    renameSync(join(dir, from), join(dir, to))
    return committed(`move ${from} to ${to}`)
  }
  return { git, commit, move }
}

export function removeScratchHistories(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
}
