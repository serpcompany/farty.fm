import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` writes a migration into `drizzle/` for each schema change, and `pnpm db:check`
// (in `pnpm check`) fails when the migrations and Drizzle's journal disagree. Wrangler applies them
// (`pnpm db:migrate:<env>`) and records each in the database's `d1_migrations` table.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite'
})
