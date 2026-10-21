import { afterEach, describe, expect, test, vi } from 'vitest'
import { pagesSitemapResponse, sitemapIndexResponse } from './sitemap'

const local = 'http://localhost:8787'
const ask = (path: string) => new Request(`${local}${path}`)

describe('sitemaps', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test.each([
    ['staging', 'https://staging.farty.fm'],
    ['production', 'https://farty.fm'],
    ['', local]
  ])("on %s, the index lists the pages sitemap on the environment's host", async (env, origin) => {
    vi.stubEnv('SITE_ENV', env)
    const response = sitemapIndexResponse(ask('/sitemap-index.xml'))
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(await response.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        `<sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap></sitemapindex>`
    )
  })

  test('the pages sitemap lists the public pages, the home page with no trailing slash', async () => {
    vi.stubEnv('SITE_ENV', 'production')
    const body = await pagesSitemapResponse(ask('/sitemap-pages.xml')).text()
    const locs = [...body.matchAll(/<loc>([^<]*)<\/loc>/gu)].map(match => match[1])
    expect(locs).toEqual([
      'https://farty.fm',
      'https://farty.fm/privacy/',
      'https://farty.fm/support/'
    ])
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><urlset xmlns=/u)
  })
})
