import { defineConfig, devices } from '@playwright/test'

const onProductionBuild = process.env.E2E_SERVER === 'preview'
const port = onProductionBuild ? 8787 : Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`
const inCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/results',
  fullyParallel: true,
  forbidOnly: inCI,
  retries: inCI ? 1 : 0,
  workers: onProductionBuild ? 1 : undefined,
  expect: { timeout: 15_000 },
  reporter: inCI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  // The record journeys feed a fixture to Chromium's fake microphone, which only Chromium has.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: onProductionBuild
          ? `pnpm exec opennextjs-cloudflare preview --port ${port}`
          : `pnpm exec next dev --port ${port}`,
        url: `${baseURL}/`,
        reuseExistingServer: !inCI,
        timeout: 240_000
      }
})
