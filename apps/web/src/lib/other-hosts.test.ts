import { describe, expect, test } from 'vitest'
import { canonicalPath, otherHostResponse } from './other-hosts'
import { smokeTestHeader } from './staging-access'

const www = 'https://www.pedos.app'
const production = 'https://pedos.app'
const staging = 'https://staging.pedos.app'
const stagingWorker = 'https://pedos-web-staging.serpcompany.workers.dev'
const productionWorker = 'https://pedos-web-production.serpcompany.workers.dev'

const answer = (url: string, siteEnv?: string, headers: Record<string, string> = {}) =>
  otherHostResponse(new Request(url, { headers }), siteEnv)

describe('canonicalPath', () => {
  test.each([
    ['/', '/'],
    ['/privacy', '/privacy/'],
    ['/privacy/', '/privacy/'],
    ['/recordings/x', '/recordings/x/'],
    ['/robots.txt', '/robots.txt'],
    ['/sitemap-index.xml/', '/sitemap-index.xml'],
    ['/fixtures/recordings/index.json', '/fixtures/recordings/index.json'],
    ['/_next/image', '/_next/image'],
    ['/.well-known/change-password', '/.well-known/change-password']
  ])('serves %s as %s', (path, served) => {
    expect(canonicalPath(path)).toBe(served)
  })
})

describe('otherHostResponse', () => {
  test.each([
    [`${www}/`, `${production}/`],
    [`${www}/privacy`, `${production}/privacy/`],
    [`${www}/support/?from=app`, `${production}/support/?from=app`],
    [`${www}/robots.txt`, `${production}/robots.txt`],
    [`${www}/sitemap-index.xml/`, `${production}/sitemap-index.xml`],
    [`${www}/_next/image?url=%2Fa.png&w=64`, `${production}/_next/image?url=%2Fa.png&w=64`]
  ])('sends %s to %s in one 308', (from, to) => {
    const response = answer(from, 'production')
    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe(to)
  })

  test('sends www to Production even with the smoke test header', () => {
    const response = answer(`${www}/privacy/`, 'production', { [smokeTestHeader]: '1' })
    expect(response?.headers.get('location')).toBe(`${production}/privacy/`)
  })

  test.each([
    [stagingWorker, 'staging', staging],
    [stagingWorker, undefined, staging],
    [productionWorker, 'production', production]
  ])("sends %s, on %s, to its environment's host", (worker, siteEnv, origin) => {
    for (const path of ['/privacy', '/privacy/']) {
      const response = answer(`${worker}${path}`, siteEnv)
      expect(response?.status).toBe(308)
      expect(response?.headers.get('location')).toBe(`${origin}/privacy/`)
    }
  })

  test('leaves a workers.dev request to the site when it carries the smoke test header', () => {
    expect(answer(`${stagingWorker}/privacy/`, 'staging', { [smokeTestHeader]: '1' })).toBeNull()
    expect(
      answer(`${productionWorker}/privacy/`, 'production', { [smokeTestHeader]: '1' })
    ).toBeNull()
  })

  test.each([
    `${production}/privacy`,
    `${staging}/privacy`,
    'http://localhost:8787/privacy',
    'https://notworkers.dev.example.com/privacy'
  ])('leaves %s to the site', url => {
    expect(answer(url, 'production')).toBeNull()
  })
})
