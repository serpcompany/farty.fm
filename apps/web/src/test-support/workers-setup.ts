import { applyD1Migrations, type D1Migration, env, reset } from 'cloudflare:test'
import { beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@opennextjs/cloudflare', async () => {
  const { env } = await import('cloudflare:test')
  return { getCloudflareContext: () => ({ env }) }
})
vi.mock('@/server/session-user', () => import('./workers-session'))

beforeEach(async () => {
  await reset()
  const { DB, TEST_MIGRATIONS } = env as unknown as {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
  }
  await applyD1Migrations(DB, TEST_MIGRATIONS)
})
