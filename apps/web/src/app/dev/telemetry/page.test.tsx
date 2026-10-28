import { afterEach, describe, expect, it, vi } from 'vitest'
import TelemetryTestPage from './page'

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
