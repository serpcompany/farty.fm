import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { createDatabase, type Database } from './database'

export type { Database } from './database'

/**
 * This request's database: the environment's `DB` binding (wrangler.jsonc). Call it inside a route
 * handler or server component, never at module scope, since `next build` runs without bindings.
 * Tests import `createDatabase` from `./database`, which has no `server-only`.
 */
export function getDb(): Database {
  return createDatabase(getCloudflareContext().env.DB)
}
