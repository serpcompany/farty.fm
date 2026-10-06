import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const interactionTests = 'src/**/*.interaction.test.tsx'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, interactionTests],
          // The golden tests analyze all 23 fixtures. One file at a time, so the timings in
          // src/lib/analysis/timing.test.ts aren't measured while other files compete for the CPU.
          testTimeout: 120_000,
          fileParallelism: false
        }
      },
      {
        extends: true,
        test: { name: 'happy-dom', include: [interactionTests], environment: 'happy-dom' }
      }
    ]
  }
})
