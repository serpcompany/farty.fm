import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { docsOnlyChain, gitIn, WALK_LIMIT } from './ci-scope.mjs'

export const REQUIRED_ON_PUSH = {
  'repository.yml': ['verify'],
  'web.yml': ['check', 'e2e'],
  'tools.yml': ['reference', 'scores']
}
const BRANCHES = ['staging', 'main']

const ghReader = path =>
  JSON.parse(
    execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  )

export function missingOn(read, sha) {
  return Object.entries(REQUIRED_ON_PUSH).flatMap(([workflow, jobs]) => {
    const { workflow_runs: runs = [] } = read(
      `repos/{owner}/{repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&per_page=100`
    )
    const passed = runs
      .filter(run => BRANCHES.includes(run.head_branch))
      .some(run => {
        const { jobs: ran = [] } = read(
          `repos/{owner}/{repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`
        )
        return jobs.every(name =>
          ran.some(job => job.name === name && job.conclusion === 'success')
        )
      })
    return passed ? [] : [`${workflow} (${jobs.join(', ')})`]
  })
}

export function ciPassed(read, git, ref, log, limit = WALK_LIMIT) {
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  let chain
  try {
    chain = docsOnlyChain(git, sha, limit)
  } catch (error) {
    log(`Couldn't read the commits under ${sha}: ${error.message}`)
    return false
  }
  if (!chain) {
    log(`${sha} sits on more than ${limit} docs-only commits, so it counts as not passed.`)
    return false
  }
  if (chain.length > 1) {
    log(`${sha} changes only docs since ${chain.at(-1)}, so a full run on any of them counts.`)
  }
  let missing = []
  for (const commit of chain) {
    missing = missingOn(read, commit)
    if (missing.length === 0) {
      log(`Every required check passed on ${commit} in a push run.`)
      return true
    }
  }
  log(`No push run passed every required check on ${chain.join(' or ')}: ${missing.join(', ')}.`)
  return false
}

function main() {
  const passed = ciPassed(
    ghReader,
    gitIn(process.cwd()),
    process.argv[2] ?? 'origin/staging',
    line => console.log(line)
  )
  process.exitCode = passed ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
