import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

/**
 * Drizzle over a D1 binding, typed by `schema.ts`. `getDb()` (`index.ts`) passes this request's
 * binding. This file has no `server-only`, so tests and code outside a request (no OpenNext
 * context) can import it and pass a binding of their own.
 */
export function createDatabase(binding: D1Database) {
  return drizzle(binding, { schema })
}

export type Database = ReturnType<typeof createDatabase>
