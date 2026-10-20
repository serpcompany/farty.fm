import { afterEach, describe, expect, test, vi } from 'vitest'
import robots from './robots'

describe('robots.txt', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test.each([['staging'], ['local'], ['']])('disallows every crawler on %s', siteEnv => {
    vi.stubEnv('SITE_ENV', siteEnv)
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } })
  })

  test('allows crawling on Production', () => {
    vi.stubEnv('SITE_ENV', 'production')
    expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/' } })
  })
})
