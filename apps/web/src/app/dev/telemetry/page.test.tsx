import { afterEach, describe, expect, it, vi } from 'vitest'
import TelemetryTestPage from './page'

// The synthetic crash and handled error are for Staging and local runs: the Production build,
// which bakes in SITE_ENV, answers 404.

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/dev/telemetry/', () => {
  it('is not found in Production', () => {
    vi.stubEnv('SITE_ENV', 'production')
    expect(() => TelemetryTestPage()).toThrow(
      expect.objectContaining({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    )
  })

  it.each(['staging', 'local'])('renders in %s', env => {
    vi.stubEnv('SITE_ENV', env)
    expect(TelemetryTestPage()).toBeTruthy()
  })
})
