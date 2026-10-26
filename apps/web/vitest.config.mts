import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

const interactionTests = 'src/**/*.interaction.test.tsx'
const workersTests = 'src/**/*.workers.test.ts'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, interactionTests, workersTests],
          // The golden tests analyze all 22 fixtures. One file at a time, so the timings in
          // src/lib/analysis/timing.test.ts aren't measured while other files compete for the CPU.
          testTimeout: 120_000,
          fileParallelism: false
        }
      },
      {
        extends: true,
        test: {
          name: 'happy-dom',
          include: [interactionTests],
          environment: 'happy-dom'
        }
      },
      {
        // The API routes in workerd, with wrangler.jsonc's bindings and compatibility settings: a
        // real D1 and R2, empty before every test, with drizzle/ applied
        // (src/test-support/workers-setup.ts). Nothing touches .wrangler/.
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
            // wrangler.jsonc's own entry imports the OpenNext build; tests call the routes directly.
            main: './src/test-support/workers-entry.ts',
            miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('./drizzle') } }
          }))
        ],
        test: {
          name: 'workers',
          include: [workersTests],
          setupFiles: ['./src/test-support/workers-setup.ts']
        }
      }
    ]
  }
})
