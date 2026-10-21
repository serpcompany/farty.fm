import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig, devices } from '@playwright/test'

const onProductionBuild = process.env.E2E_SERVER === 'preview'
const port = Number(process.env.E2E_PORT ?? (onProductionBuild ? 8787 : 3100))
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`
const inCI = Boolean(process.env.CI)

// The preview runs the Staging gate (worker.ts), which reads its password from .dev.vars, and the
// browser answers its prompt with the same password. `next dev` has no gate.
const devVars = join(__dirname, '.dev.vars')
const stagingPassword = existsSync(devVars)
  ? parseEnv(readFileSync(devVars, 'utf8')).STAGING_BASIC_AUTH_PASSWORD
  : undefined
if (onProductionBuild && !process.env.E2E_BASE_URL && !stagingPassword) {
  throw new Error('The preview asks for the Staging password: copy .dev.vars.example to .dev.vars')
}

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
    httpCredentials: stagingPassword ? { username: 'pedos', password: stagingPassword } : undefined,
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
