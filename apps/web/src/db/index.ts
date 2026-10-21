import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

/** Drizzle over a D1 binding, typed by `schema.ts`. */
export function createDatabase(binding: D1Database) {
  return drizzle(binding, { schema })
}

export type Database = ReturnType<typeof createDatabase>

/**
 * This request's database: the environment's `DB` binding (wrangler.jsonc). Call it inside a route
 * handler or server component, never at module scope, since `next build` runs without bindings.
 */
export function getDb(): Database {
  return createDatabase(getCloudflareContext().env.DB)
}
