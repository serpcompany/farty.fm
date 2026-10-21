import { describe, expect, it } from 'vitest'
import { webAnalyticsToken } from './analytics'

describe('webAnalyticsToken', () => {
  it("is pedos.app's public token in Production", () => {
    expect(webAnalyticsToken('production')).toBe('e5c178acd813418c8a128caf531d2b03')
  })

  it.each(['staging', 'local'] as const)('is none in %s, which has no beacon', env => {
    expect(webAnalyticsToken(env)).toBeNull()
  })
})
