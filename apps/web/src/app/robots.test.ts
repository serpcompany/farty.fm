import { afterEach, describe, expect, test, vi } from 'vitest'
import robots from './robots'

describe('robots.txt', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test.each([['local'], ['']])('disallows every crawler on a local run (%s)', siteEnv => {
    vi.stubEnv('SITE_ENV', siteEnv)
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } })
  })

  test("disallows every crawler on Staging but the auditor, which gets Production's rules", () => {
    vi.stubEnv('SITE_ENV', 'staging')
    expect(robots()).toEqual({
      rules: [
        { userAgent: '*', disallow: '/' },
        { userAgent: 'AhrefsSiteAudit', allow: '/' }
      ],
      sitemap: 'https://staging.pedos.app/sitemap-index.xml'
    })
  })

  test('allows crawling on Production and lists its sitemap', () => {
    vi.stubEnv('SITE_ENV', 'production')
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: 'https://pedos.app/sitemap-index.xml'
    })
  })
})
