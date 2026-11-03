import { afterEach, describe, expect, it } from 'vitest'
import { ciPassed, REQUIRED_ON_PUSH } from './ci-passed.mjs'
import { removeScratchHistories, scratchHistory } from './scratch-history'

afterEach(removeScratchHistories)

type Outcome = 'passed' | 'docs' | 'failed' | 'pull request'

const jobsOf = (outcome: Outcome, workflow: string) =>
  REQUIRED_ON_PUSH[workflow as keyof typeof REQUIRED_ON_PUSH].map(name => ({
    name,
    conclusion:
      outcome === 'failed' && name === 'e2e'
        ? 'failure'
        : outcome === 'docs' && name !== 'verify'
          ? 'skipped'
          : 'success'
  }))

function gitHub(results: Record<string, Outcome>) {
  const asked: string[] = []
  const runs = Object.entries(results).flatMap(([sha, outcome], index) =>
    Object.keys(REQUIRED_ON_PUSH).map((workflow, at) => ({
      id: index * 10 + at,
      sha,
      workflow,
      outcome,
      head_branch: outcome === 'pull request' ? 'issue-1-thing' : 'staging'
    }))
  )
  const read = (path: string) => {
    asked.push(path)
    const listed = /workflows\/([^/]+)\/runs\?head_sha=(\w+)/.exec(path)
    if (listed) {
      return {
        workflow_runs: runs.filter(run => run.workflow === listed[1] && run.sha === listed[2])
      }
    }
    const jobs = /runs\/(\d+)\/jobs/.exec(path)
    const run = runs.find(each => String(each.id) === jobs?.[1])
    if (!run) throw new Error(`nothing answers ${path}`)
    return { jobs: jobsOf(run.outcome, run.workflow) }
  }
  return { read, asked }
}

function passed(
  results: Record<string, Outcome>,
  tip: string,
  git: (args: string[]) => string,
  limit?: number
) {
  const log: string[] = []
  const { read } = gitHub(results)
  return { passed: ciPassed(read, git, tip, (line: string) => log.push(line), limit), log }
}

describe('whether CI passed on a commit, before it is promoted', () => {
  it('passes a commit whose push runs passed every required check', () => {
    const { git, commit } = scratchHistory()
    const code = commit('apps/web/src/a.ts')
    expect(passed({ [code]: 'passed' }, code, git)).toEqual({
      passed: true,
      log: [`Every required check passed on ${code} in a push run.`]
    })
  })

  it('counts a docs-only commit on a commit that passed, walking back past every docs-only one', () => {
    const { git, commit } = scratchHistory()
    const code = commit('apps/web/src/a.ts')
    commit('docs/agents/a.md')
    const docs = commit('docs/agents/b.md')
    const { passed: ok, log } = passed({ [docs]: 'docs', [code]: 'passed' }, docs, git)
    expect(ok).toBe(true)
    expect(log[0]).toBe(
      `${docs} changes only docs since ${code}, so a full run on any of them counts.`
    )
  })

  it('refuses a docs-only commit on a commit that failed, though its own run, which skipped the checks, is green', () => {
    const { git, commit } = scratchHistory()
    const code = commit('apps/web/src/a.ts')
    const docs = commit('docs/agents/a.md')
    const { passed: ok, log } = passed({ [docs]: 'docs', [code]: 'failed' }, docs, git)
    expect(ok).toBe(false)
    expect(log.at(-1)).toBe(
      `No push run passed every required check on ${docs} or ${code}: web.yml (check, e2e).`
    )
  })

  it("doesn't count a pull request branch's run, nor a commit no push run checked", () => {
    const { git, commit } = scratchHistory()
    const code = commit('apps/web/src/a.ts')
    expect(passed({ [code]: 'pull request' }, code, git).passed).toBe(false)
    const later = commit('apps/web/src/b.ts')
    expect(passed({ [code]: 'passed' }, later, git).passed).toBe(false)
  })

  it('counts as not passed a commit on more docs-only commits than the walk allows', () => {
    const { git, commit } = scratchHistory()
    const code = commit('apps/web/src/a.ts')
    commit('docs/a.md')
    const docs = commit('docs/b.md')
    const { passed: ok, log } = passed({ [code]: 'passed' }, docs, git, 1)
    expect(ok).toBe(false)
    expect(log).toEqual([
      `${docs} sits on more than 1 docs-only commits, so it counts as not passed.`
    ])
  })
})
