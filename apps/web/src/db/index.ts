import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { createDatabase, type Database } from './database'

export type { Database } from './database'

export function getDb(): Database {
  return createDatabase(getCloudflareContext().env.DB)
}
