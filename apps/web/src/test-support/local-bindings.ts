// A real local D1 and dev mailbox KV for Node tests: wrangler.jsonc's top level through Wrangler's
// platform proxy, in memory, with every migration in drizzle/ applied. Test input only: nothing here
// ships.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'

const CONFIG = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url))
const MIGRATIONS = fileURLToPath(new URL('../../drizzle/', import.meta.url))

export type LocalBindings = {
  DB: D1Database
  DEV_MAILBOX: KVNamespace
  /** Empties every table and the mailbox, keeping the schema. */
  reset(): Promise<void>
  dispose(): Promise<void>
}

export async function localBindings(): Promise<LocalBindings> {
  const proxy = await getPlatformProxy<{ DB: D1Database; DEV_MAILBOX: KVNamespace }>({
    configPath: CONFIG,
    persist: false
  })
  const { DB, DEV_MAILBOX } = proxy.env
  const files = readdirSync(MIGRATIONS)
    .filter(file => file.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const statements = readFileSync(`${MIGRATIONS}${file}`, 'utf8').split(
      '--> statement-breakpoint'
    )
    for (const statement of statements) if (statement.trim()) await DB.prepare(statement).run()
  }
  const tables = await DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
  ).all<{ name: string }>()

  async function reset() {
    await DB.batch(tables.results.map(({ name }) => DB.prepare(`DELETE FROM "${name}"`)))
    const { keys } = await DEV_MAILBOX.list()
    await Promise.all(keys.map(({ name }) => DEV_MAILBOX.delete(name)))
  }

  return { DB, DEV_MAILBOX, reset, dispose: proxy.dispose }
}
