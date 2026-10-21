import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler'
import { parse } from 'yaml'
import { siteOrigin } from '../lib/site'
import { SUPPORT_EMAIL } from '../server/email'

// Each deployed environment's own D1 and R2, its hosts and sender, and the guards that keep local
// things local: the dev mailbox exists only at wrangler.jsonc's top level, which is never deployed,
// and every command that deploys or changes a remote database names its environment with --env.
// Without --env, Wrangler reads the top level.

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const CONFIG = path('../../wrangler.jsonc')
const WORKFLOWS = path('../../../../.github/workflows/')
const DEPLOYED = ['staging', 'production'] as const
type Deployed = (typeof DEPLOYED)[number]

type RawConfig = { env?: Record<string, unknown>; kv_namespaces?: { binding: string }[] }
const raw = (): RawConfig => experimental_readRawConfig({ config: CONFIG }).rawConfig as RawConfig
/** The config Wrangler uses for one environment, or for the top level. */
type Resolved = {
  d1_databases: { database_id?: string }[]
  r2_buckets: unknown[]
  kv_namespaces: { binding: string }[]
  vars: Record<string, unknown>
  routes?: unknown[]
  send_email: { name: string; allowed_sender_addresses?: string[] }[]
}
const resolved = (env?: Deployed): Resolved =>
  unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true })

const scripts: Record<string, string> = JSON.parse(
  readFileSync(path('../../package.json'), 'utf8')
).scripts

type Step = { name?: string; run?: string }
type Job = { environment?: string | { name: string }; steps?: Step[] }
const workflows: Record<string, { jobs: Record<string, Job> }> = Object.fromEntries(
  readdirSync(WORKFLOWS)
    .filter(file => /^web.*\.ya?ml$/.test(file))
    .map(file => [file, parse(readFileSync(`${WORKFLOWS}${file}`, 'utf8'))])
)

/** The deployed environments whose config mentions the dev mailbox in any way. */
function environmentsWithDevMailbox(config: RawConfig): string[] {
  return Object.entries(config.env ?? {})
    .filter(([, environment]) => JSON.stringify(environment).includes('DEV_MAILBOX'))
    .map(([name]) => name)
}

/** Each command in a script or a step's `run`. */
function commandsIn(text: string): string[] {
  return text
    .split(/&&|\|\||;|\n/)
    .map(command => command.trim())
    .filter(Boolean)
}

/** A command that deploys a Worker, or reads or changes a remote D1, R2 or secret. */
function reachesCloudflare(command: string): boolean {
  if (!/\b(wrangler|opennextjs-cloudflare)\b/.test(command)) return false
  return (
    /\b(deploy|upload|secret)\b/.test(command) ||
    /--remote\b/.test(command) ||
    (/\bd1 (migrations apply|execute)\b/.test(command) && !/--local\b/.test(command))
  )
}

/** The environment a command names with --env, if any. */
function environmentOf(command: string): string | undefined {
  return command.match(/--env[ =](\S+)/)?.[1]
}

/** Commands that reach Cloudflare without naming a deployed environment. */
function commandsWithoutEnv(commands: string[]): string[] {
  return commands.filter(
    command => reachesCloudflare(command) && !DEPLOYED.includes(environmentOf(command) as Deployed)
  )
}

/** A step's commands, with each `pnpm <script>` replaced by that script's own commands. */
function expand(command: string, seen = new Set<string>()): string[] {
  const script = command.match(/^pnpm (?:run )?([\w:-]+)$/)?.[1]
  if (!script || !(script in scripts) || seen.has(script)) return [command]
  seen.add(script)
  return commandsIn(scripts[script]).flatMap(inner => expand(inner, seen))
}

const environmentName = (job: Job) =>
  typeof job.environment === 'string' ? job.environment : job.environment?.name

describe('each deployed environment', () => {
  it('is staging or production', () => {
    expect(Object.keys(raw().env ?? {}).sort()).toEqual([...DEPLOYED].sort())
  })

  it.each(DEPLOYED)('%s binds its own D1 as DB and its own R2 bucket as MEDIA', env => {
    const config = resolved(env)
    expect(config.d1_databases).toEqual([
      {
        binding: 'DB',
        database_name: `pedos-${env}`,
        database_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        ),
        migrations_dir: 'drizzle',
        migrations_table: 'd1_migrations'
      }
    ])
    expect(config.r2_buckets).toEqual([{ binding: 'MEDIA', bucket_name: `pedos-${env}` }])
  })

  // site.ts and SUPPORT_EMAIL are the only places a host or the sender is spelled. Sign-in answers
  // 503 (`auth_url_invalid`) when BETTER_AUTH_URL isn't the served origin, and Email Sending
  // refuses a sender its binding doesn't allow, so a mismatch would show only after a deploy.
  it.each(DEPLOYED)('%s serves, signs in and sends on its own host from site.ts', env => {
    const config = resolved(env)
    const origin = siteOrigin(env) as string
    const { hostname } = new URL(origin)
    expect(config.vars.BETTER_AUTH_URL).toBe(origin)
    expect(config.routes).toEqual([
      { pattern: hostname, custom_domain: true },
      ...(env === 'production' ? [{ pattern: `www.${hostname}`, custom_domain: true }] : [])
    ])
    expect(config.vars.EMAIL_FROM).toBe(`Farty <${SUPPORT_EMAIL}>`)
    expect(config.send_email.map(binding => binding.allowed_sender_addresses)).toEqual([
      [SUPPORT_EMAIL]
    ])
  })

  it('has a different database from every other environment', () => {
    const ids = [undefined, ...DEPLOYED].map(env => resolved(env).d1_databases[0]?.database_id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('local-only-do-not-deploy')
  })
})

describe('the dev mailbox', () => {
  it('is bound at the top level only, with no id', () => {
    expect(raw().kv_namespaces).toEqual([{ binding: 'DEV_MAILBOX' }])
    expect(resolved().kv_namespaces.map(kv => kv.binding)).toContain('DEV_MAILBOX')
  })

  it.each(DEPLOYED)('is not in %s', env => {
    expect(environmentsWithDevMailbox(raw())).not.toContain(env)
    expect(resolved(env).kv_namespaces.map(kv => kv.binding)).not.toContain('DEV_MAILBOX')
  })

  it('is caught in a deployed environment', () => {
    const config = structuredClone(raw())
    const staging = config.env?.staging as RawConfig
    staging.kv_namespaces = [{ binding: 'DEV_MAILBOX' }]
    expect(environmentsWithDevMailbox(config)).toEqual(['staging'])
  })
})

describe('every deploy and remote migration', () => {
  it('names its environment in package.json', () => {
    const commands = Object.values(scripts).flatMap(commandsIn)
    expect(commands.filter(reachesCloudflare).length).toBeGreaterThanOrEqual(6)
    expect(commandsWithoutEnv(commands)).toEqual([])
  })

  it.each(Object.keys(workflows))('names its environment in %s', file => {
    const steps = Object.values(workflows[file].jobs).flatMap(job => job.steps ?? [])
    const commands = steps.flatMap(step => commandsIn(step.run ?? '')).flatMap(c => expand(c))
    expect(commandsWithoutEnv(commands)).toEqual([])
  })

  it('is caught without --env', () => {
    expect(
      commandsWithoutEnv([
        'opennextjs-cloudflare deploy',
        'wrangler deploy --env=staging',
        'wrangler d1 migrations apply pedos-staging --remote',
        'wrangler d1 migrations apply DB',
        'wrangler secret put BETTER_AUTH_SECRET',
        'wrangler d1 migrations apply pedos-local --local',
        'opennextjs-cloudflare build'
      ])
    ).toEqual([
      'opennextjs-cloudflare deploy',
      'wrangler d1 migrations apply pedos-staging --remote',
      'wrangler d1 migrations apply DB',
      'wrangler secret put BETTER_AUTH_SECRET'
    ])
  })

  it.each(DEPLOYED)('migrates %s before deploying it, in its own environment only', env => {
    const jobs = Object.values(workflows)
      .flatMap(workflow => Object.values(workflow.jobs))
      .filter(job => environmentName(job) === env)
    expect(jobs).toHaveLength(1)
    const steps = (jobs[0].steps ?? []).map(step => commandsIn(step.run ?? ''))
    const expanded = steps.map(commands => commands.flatMap(command => expand(command)))
    const migrate = steps.findIndex(commands => commands.includes(`pnpm db:migrate:${env}`))
    const deploy = expanded.findIndex(commands =>
      commands.some(command => /\b(opennextjs-cloudflare|wrangler) deploy\b/.test(command))
    )
    expect(migrate).toBeGreaterThanOrEqual(0)
    expect(deploy).toBeGreaterThan(migrate)
    const remote = expanded.flat().filter(reachesCloudflare)
    expect(remote.map(environmentOf)).toEqual(remote.map(() => env))
  })
})

describe('E2E', () => {
  it('applies the migrations to the local database before the journeys', () => {
    const steps = workflows['web.yml'].jobs.e2e.steps ?? []
    const migrate = steps.findIndex(step => step.run === 'pnpm db:migrate:local')
    const journeys = steps.findIndex(step => step.run === 'pnpm test:e2e')
    expect(migrate).toBeGreaterThanOrEqual(0)
    expect(journeys).toBeGreaterThan(migrate)
    expect(scripts['db:migrate:local']).toMatch(/--local\b/)
  })
})
