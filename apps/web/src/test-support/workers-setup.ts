/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, type D1Migration, env, reset } from 'cloudflare:test'
import { beforeEach, vi } from 'vitest'

// The `workers` project's setup: the routes run in workerd with the test Worker's own D1 and R2,
// which every test starts empty, with `drizzle/` applied.

// The routes reach their bindings through OpenNext's Cloudflare context, here the test Worker's.
vi.mock('server-only', () => ({}))
vi.mock('@opennextjs/cloudflare', async () => {
  const { env } = await import('cloudflare:test')
  return { getCloudflareContext: () => ({ env }) }
})
// Until sign-in (#152) is wired in, tests sign in through a real `session` row
// (`workers-session.ts`), so deleting a user signs them out here as it will there.
vi.mock('@/server/session-user', () => import('./workers-session'))

beforeEach(async () => {
  await reset()
  const { DB, TEST_MIGRATIONS } = env as unknown as {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
  await applyD1Migrations(DB, TEST_MIGRATIONS)
})
