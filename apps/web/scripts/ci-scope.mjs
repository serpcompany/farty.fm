import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const DOCS_PATHS = [
  /^[^/]+\.md$/,
  /^docs\/.+\.md$/,
  /^\.claude\/skills\/.+\.md$/,
  /^apps\/web\/docs\/.+\.md$/,
  /^apps\/web\/(?:AGENTS|CLAUDE)\.md$/,
  /^tools\/.+\.md$/,
  /^fixtures\/golden\/[^/]+\.md$/
]
export const READ_BY_TESTS = new Set(['tools/catalog/README.md', 'fixtures/golden/port-tests.md'])
const GENERATED = [/\.report\.md$/, /^tools\/catalog\/ranking\.md$/]
export const WALK_LIMIT = 50

export function isDoc(path) {
  return (
    DOCS_PATHS.some(docs => docs.test(path)) &&
    !READ_BY_TESTS.has(path) &&
    !GENERATED.some(generated => generated.test(path))
  )
}

export function isDocsOnlyChange(paths) {
  return paths.length > 0 && paths.every(isDoc)
}

export const gitIn = cwd => args =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

export function changedPaths(git, from, to) {
  return git(['diff', '--name-only', '--no-renames', from, to]).split('\n').filter(Boolean)
}

export function docsOnlyChain(git, sha, limit = WALK_LIMIT) {
  const chain = []
  for (let commit = sha; ; ) {
    const [found, parent] = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(' ')
    chain.push(found)
    if (!parent || !isDocsOnlyChange(changedPaths(git, parent, found))) break
    if (chain.length > limit) return null
    commit = parent
  }
  const since = changedPaths(git, chain.at(-1), chain[0])
  if (since.length && !isDocsOnlyChange(since)) {
    throw new Error(`${chain.at(-1)}..${chain[0]} changes more than docs`)
  }
  return chain
}

export function classify(git, base, head = 'HEAD') {
  if (!base || /^0+$/.test(base)) {
    return { docs: false, said: 'No earlier commit to compare with, so every check runs.' }
  }
  const paths = changedPaths(git, base, head)
  const docs = isDocsOnlyChange(paths)
  const what = docs
    ? 'only docs, which nothing builds or tests, so only the docs checks run'
    : 'more than docs, so every check runs'
  return { docs, said: `${paths.length} changed file(s) against ${base}: ${what}.` }
}

function main() {
  const { docs, said } = classify(gitIn(process.cwd()), process.argv[2], process.argv[3])
  console.log(said)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs=${docs}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
