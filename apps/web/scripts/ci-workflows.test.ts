import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Step = { id?: string; uses?: string; run?: string; name?: string }
type Job = {
  if?: string
  needs?: string | string[]
  env?: Record<string, string>
  outputs?: Record<string, string>
  steps?: Step[]
}
type Workflow = {
  on: Record<string, { paths?: string[]; 'paths-ignore'?: string[] } | null>
  jobs: Record<string, Job>
}

const folder = new URL('../../../.github/', import.meta.url)
const workflow = (name: string): Workflow =>
  parse(readFileSync(new URL(`workflows/${name}`, folder), 'utf8'))
const needs = (job: Job) => [job.needs ?? []].flat()
const docs = (classify: string) => `needs.${classify}.outputs.docs != 'true'`
const expression = (inner: string) => `\${{ ${inner} }}`

const scoped = [
  {
    file: 'web.yml',
    classify: 'changes',
    checks: ['check', 'e2e-shard', 'e2e'],
    full: {
      check: ['WEB', "needs.changes.outputs.web || 'true'"],
      'e2e-shard': [
        'RUN',
        "needs.changes.result != 'success' || needs.changes.outputs.e2e == 'true'"
      ]
    }
  },
  {
    file: 'tools.yml',
    classify: 'tools-changes',
    checks: ['reference', 'scores'],
    full: {
      reference: ['TOOLS', "needs.tools-changes.outputs.tools || 'true'"],
      scores: ['TOOLS', "needs.tools-changes.outputs.tools || 'true'"]
    }
  }
] as const

describe('CI checks what its change can affect (SERP CI Scope)', () => {
  it('classifies each change once in each workflow that checks code, with the shared ci-scope action', () => {
    for (const [file, classify] of [
      ['web.yml', 'changes'],
      ['tools.yml', 'tools-changes'],
      ['repository.yml', 'verify-changes']
    ]) {
      const job = workflow(file).jobs[classify]
      expect(job.steps?.find(step => step.uses === './.github/actions/ci-scope')?.id, file).toBe(
        'scope'
      )
      expect(job.outputs?.docs, file).toBe(expression('steps.scope.outputs.docs'))
    }
    const action = readFileSync(new URL('actions/ci-scope/action.yml', folder), 'utf8')
    expect(action).toContain('base=HEAD^1')
    expect(action).toContain('git fetch --quiet --no-tags --depth=1 origin "$BEFORE"')
    expect(action).toContain('node apps/web/scripts/ci-scope.mjs "$base" HEAD')
  })

  it("skips the web app's and the tools' checks on a docs-only change, and runs them in full when the change couldn't be classified", () => {
    for (const { file, classify, checks, full } of scoped) {
      const { jobs } = workflow(file)
      for (const name of checks) {
        const job = jobs[name]
        expect(needs(job), name).toContain(classify)
        expect(job.if, name).toContain(`\${{ !cancelled() && ${docs(classify)}`)
      }
      for (const [name, [variable, value]] of Object.entries(full)) {
        expect(jobs[name].env?.[variable], name).toBe(expression(value))
      }
    }
  })

  it("deploys nothing for a docs-only push, nor when the change couldn't be classified", () => {
    const { jobs } = workflow('web.yml')
    for (const name of ['deploy-staging', 'deploy-production']) {
      expect(needs(jobs[name]), name).toEqual(['changes', 'check', 'e2e'])
      expect(jobs[name].if, name).toContain(docs('changes'))
      expect(jobs[name].if, name).not.toContain('cancelled()')
    }
  })

  it("runs only verify's docs and secrets checks on a docs-only change, and every check otherwise", () => {
    const { verify } = workflow('repository.yml').jobs
    expect(needs(verify)).toEqual(['verify-changes'])
    expect(verify.if).toBe(expression('!cancelled()'))
    expect(verify.env?.DOCS).toBe(expression('needs.verify-changes.outputs.docs'))
    const checks = verify.steps?.find(step => step.run?.includes('pnpm verify'))?.run
    expect(checks).toContain(
      'if [ "$DOCS" = true ]; then\n  pnpm verify docs,secrets\nelse\n  pnpm verify\nfi'
    )
  })

  it('still runs the pull request checks and the code review on a docs-only change', () => {
    for (const file of ['pull-request.yml', 'code-review.yml']) {
      for (const [name, job] of Object.entries(workflow(file).jobs)) {
        expect(job.if ?? '', `${file} ${name}`).not.toContain('outputs.docs')
      }
    }
  })

  it('never filters a pull request or push workflow by its paths, which would leave its required checks waiting', () => {
    for (const file of readdirSync(new URL('workflows/', folder))) {
      const { on } = workflow(file)
      for (const event of ['pull_request', 'push']) {
        expect(on[event]?.paths, `${file} ${event}`).toBeUndefined()
        expect(on[event]?.['paths-ignore'], `${file} ${event}`).toBeUndefined()
      }
    }
  })
})
