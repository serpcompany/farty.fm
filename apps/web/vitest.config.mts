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
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, interactionTests, workersTests],
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
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
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
