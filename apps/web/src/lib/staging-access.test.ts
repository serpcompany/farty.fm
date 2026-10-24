import * as nodeCrypto from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { fixtureLibraryPath } from './fixture-library'
import {
  basicAuthPassword,
  behindStagingAccess,
  type EntryEnv,
  environmentNoindex,
  passwordMatches,
  servedByTheEntry,
  smokeTestHeader,
  stagingAccessChallenge
} from './staging-access'

vi.mock('node:crypto', async original => {
  const actual = await original<typeof import('node:crypto')>()
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) }
})

const password = 'stagingpassword'
const staging = 'https://pedos-web-staging.serpcompany.workers.dev'

const basic = (credentials: string) =>
  `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(credentials)))}`

type Asking = { headers?: Record<string, string>; method?: string; expected?: string }

function ask(path: string, asking: Asking = {}) {
  const expected = 'expected' in asking ? asking.expected : password
  const url = new URL(path, staging)
  const request = new Request(url, { headers: asking.headers, method: asking.method ?? 'GET' })
  const serve = vi.fn(
    async (forwarded: Request) =>
      new Response(`served ${forwarded.headers.get('Authorization') ?? 'without authorization'}`, {
        headers: { 'Cache-Control': 'public, max-age=60' }
      })
  )
  return { response: behindStagingAccess(request, url, expected, serve), serve }
}

describe('basicAuthPassword', () => {
  test.each([
    [basic('pedos:stagingpassword'), 'stagingpassword'],
    [basic(':stagingpassword'), 'stagingpassword'],
    [basic('anyone:pass:with:colons'), 'pass:with:colons'],
    [`basic ${btoa('x:stagingpassword')}`, 'stagingpassword'],
    [basic('ユーザー:パスワード'), 'パスワード']
  ])('reads the password of %s', (header, expected) => {
    expect(basicAuthPassword(header)).toBe(expected)
  })

  test.each([
    [null],
    [''],
    ['Bearer abc'],
    [basic('no-colon')],
    ['Basic not base64!'],
    ['Basic']
  ])('finds no password in %s', header => {
    expect(basicAuthPassword(header)).toBeNull()
  })
})

describe('passwordMatches', () => {
  test('matches only the same password', async () => {
    expect(await passwordMatches('stagingpassword', 'stagingpassword')).toBe(true)
    expect(await passwordMatches('stagingpasswor', 'stagingpassword')).toBe(false)
    expect(await passwordMatches('stagingpassword!', 'stagingpassword')).toBe(false)
    expect(await passwordMatches('', 'stagingpassword')).toBe(false)
  })

  test('compares equal-length SHA-256 digests in constant time, whatever the lengths given', async () => {
    const timingSafeEqual = vi.mocked(nodeCrypto.timingSafeEqual)
    timingSafeEqual.mockClear()
    expect(await passwordMatches('a much longer password than the real one', 'short')).toBe(false)
    expect(timingSafeEqual).toHaveBeenCalledOnce()
    const [given, expected] = timingSafeEqual.mock.calls[0] as [Uint8Array, Uint8Array]
    expect(given.byteLength).toBe(32)
    expect(expected.byteLength).toBe(32)
  })
})

describe('behindStagingAccess', () => {
  test('asks for the password, and serves nothing, when a request has none', async () => {
    const { response, serve } = ask('/recordings/')
    const refused = await response
    expect(refused.status).toBe(401)
    expect(refused.headers.get('WWW-Authenticate')).toBe(stagingAccessChallenge)
    expect(stagingAccessChallenge).toBe('Basic realm="farty staging", charset="UTF-8"')
    expect(refused.headers.get('Cache-Control')).toBe('no-store')
    expect(refused.headers.get('X-Robots-Tag')).toBe(environmentNoindex)
    expect(await refused.text()).toBe('Staging asks for a password.\n')
    expect(serve).not.toHaveBeenCalled()
  })

  test('answers a HEAD request it refuses with no body', async () => {
    const refused = await ask('/', { method: 'HEAD' }).response
    expect(refused.status).toBe(401)
    expect(refused.body).toBeNull()
  })

  test('refuses a wrong password, whatever the username', async () => {
    for (const credentials of ['pedos:wrong', 'pedos:', 'stagingpassword:x']) {
      const { response, serve } = ask('/', { headers: { Authorization: basic(credentials) } })
      expect((await response).status).toBe(401)
      expect(serve).not.toHaveBeenCalled()
    }
  })

  test('serves the password with any username, without its Authorization and with no noindex', async () => {
    for (const credentials of ['pedos:stagingpassword', ':stagingpassword']) {
      const { response, serve } = ask('/recordings/', {
        headers: { Authorization: basic(credentials) }
      })
      const passed = await response
      expect(passed.status).toBe(200)
      expect(await passed.text()).toBe('served without authorization')
      expect(passed.headers.get('X-Robots-Tag')).toBeNull()
      expect(passed.headers.get('Cache-Control')).toBe('public, max-age=60')
      expect(serve).toHaveBeenCalledOnce()
    }
  })

  test('strips Authorization from a request with a body, and keeps the body', async () => {
    const url = new URL('/', staging)
    const request = new Request(url, {
      method: 'POST',
      body: 'a body',
      headers: { Authorization: basic('pedos:stagingpassword'), 'Content-Type': 'text/plain' }
    })
    const passed = await behindStagingAccess(request, url, password, async forwarded => {
      expect(forwarded.headers.has('Authorization')).toBe(false)
      expect(forwarded.headers.get('Content-Type')).toBe('text/plain')
      return new Response(await forwarded.text())
    })
    expect(await passed.text()).toBe('a body')
  })

  test('keeps a page its own X-Robots-Tag once the password passed', async () => {
    const url = new URL('/', staging)
    const request = new Request(url, { headers: { Authorization: basic('x:stagingpassword') } })
    const passed = await behindStagingAccess(request, url, password, async () =>
      Response.json({}, { headers: { 'X-Robots-Tag': 'noindex' } })
    )
    expect(passed.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  test('fails closed without its password variable', async () => {
    for (const expected of [undefined, '']) {
      const { response, serve } = ask('/', {
        headers: { Authorization: basic('pedos:stagingpassword') },
        expected
      })
      expect((await response).status).toBe(401)
      expect(serve).not.toHaveBeenCalled()
    }
  })

  test('serves robots.txt without the password, with noindex', async () => {
    const withAndWithoutAWrongPassword: Record<string, string>[] = [
      {},
      { Authorization: basic('pedos:wrong') }
    ]
    for (const headers of withAndWithoutAWrongPassword) {
      for (const method of ['GET', 'HEAD']) {
        const { response, serve } = ask('/robots.txt', { headers, method })
        const exempt = await response
        expect(exempt.status).toBe(200)
        expect(exempt.headers.get('X-Robots-Tag')).toBe(environmentNoindex)
        expect(serve).toHaveBeenCalledOnce()
      }
    }
  })

  test('asks for the password on any other robots.txt request', async () => {
    for (const path of ['/robots.txt/', '/robots.txt.bak', '/ROBOTS.TXT', '/x/robots.txt']) {
      expect((await ask(path).response).status, path).toBe(401)
    }
    expect((await ask('/robots.txt', { method: 'POST' }).response).status).toBe(401)
  })

  test("serves Stripe's webhook without the password, with noindex, to a POST only", async () => {
    const { response, serve } = ask('/api/stripe/webhook/', { method: 'POST' })
    const exempt = await response
    expect(exempt.status).toBe(200)
    expect(exempt.headers.get('X-Robots-Tag')).toBe(environmentNoindex)
    expect(serve).toHaveBeenCalledOnce()
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await ask('/api/stripe/webhook/', { method }).response).status, method).toBe(401)
    }
    for (const path of ['/api/stripe/webhook', '/api/stripe/', '/api/toots/', '/']) {
      expect((await ask(path, { method: 'POST' }).response).status, path).toBe(401)
    }
  })

  test("serves the smoke test's header without the password, with noindex", async () => {
    expect(smokeTestHeader).toBe('x-pedos-smoke-test')
    const { response, serve } = ask('/', { headers: { [smokeTestHeader]: '1' } })
    const exempt = await response
    expect(exempt.status).toBe(200)
    expect(exempt.headers.get('X-Robots-Tag')).toBe(environmentNoindex)
    expect(serve).toHaveBeenCalledOnce()
  })

  test("checks a password sent with the smoke test's header", async () => {
    for (const authorization of [basic('pedos:wrong'), 'Bearer abc', '']) {
      const wrong = ask('/', {
        headers: { [smokeTestHeader]: '1', Authorization: authorization }
      })
      const refused = await wrong.response
      expect(refused.status, authorization).toBe(401)
      expect(refused.headers.get('WWW-Authenticate')).toBe(stagingAccessChallenge)
      expect(wrong.serve).not.toHaveBeenCalled()
    }
    const right = await ask('/', {
      headers: { [smokeTestHeader]: '1', Authorization: basic('pedos:stagingpassword') }
    }).response
    expect(right.status).toBe(200)
    expect(right.headers.get('X-Robots-Tag')).toBeNull()
  })

  const fixtureFiles = [
    `${fixtureLibraryPath}index.json`,
    `${fixtureLibraryPath}090.wav`,
    '/fixtures/',
    '/FIXTURES/recordings/090.wav',
    '/%66ixtures/recordings/index.json',
    `${staging}//fixtures/recordings/index.json`,
    '/x/../fixtures/recordings/index.json',
    '/fixtures%2Frecordings%2Findex.json',
    '/%E0%A4%A/fixtures'
  ]

  test("asks for the Fixture Library's password even with the smoke test's header", async () => {
    for (const path of fixtureFiles) {
      for (const method of ['GET', 'HEAD']) {
        const { response, serve } = ask(path, { headers: { [smokeTestHeader]: '1' }, method })
        const refused = await response
        expect(refused.status, `${method} ${path}`).toBe(401)
        expect(refused.headers.get('WWW-Authenticate')).toBe(stagingAccessChallenge)
        expect(serve).not.toHaveBeenCalled()
      }
    }
  })

  test("serves the Fixture Library with the password, with or without the smoke test's header", async () => {
    for (const headers of [{}, { [smokeTestHeader]: '1' }] as Record<string, string>[]) {
      const { response, serve } = ask(`${fixtureLibraryPath}index.json`, {
        headers: { ...headers, Authorization: basic('pedos:stagingpassword') }
      })
      expect((await response).status).toBe(200)
      expect(serve).toHaveBeenCalledOnce()
    }
  })

  test("still serves every other path with the smoke test's header", async () => {
    for (const path of [
      '/',
      '/recordings/',
      '/compose/',
      '/welcome-icon.png',
      '/fixture',
      '/x-fixtures/'
    ]) {
      const { response, serve } = ask(path, { headers: { [smokeTestHeader]: '1' } })
      expect((await response).status, path).toBe(200)
      expect(serve).toHaveBeenCalledOnce()
    }
  })
})

describe('servedByTheEntry', () => {
  const staticFile = '/welcome-icon.png'

  function entry(env: EntryEnv, path: string, init: RequestInit = {}) {
    const assets = vi.fn(async (request: Request) =>
      new URL(request.url).pathname === staticFile
        ? new Response('png', {
            headers: {
              'Content-Type': 'image/png',
              'Authorization-Seen': String(request.headers.has('Authorization'))
            }
          })
        : new Response('not an asset', { status: 404 })
    )
    const page = vi.fn(
      async (request: Request) =>
        new Response(`page ${new URL(request.url).pathname}`, { headers: { 'X-Page': '1' } })
    )
    const response = servedByTheEntry(
      new Request(new URL(path, staging), init),
      { ...env, ASSETS: { fetch: assets } },
      page
    )
    return { response, assets, page }
  }

  const stagingEnv: EntryEnv = { SITE_ENV: 'staging', STAGING_BASIC_AUTH_PASSWORD: password }
  const withPassword = { headers: { Authorization: basic('pedos:stagingpassword') } }

  test('asks for the password for a static file, and never reads it from assets', async () => {
    const { response, assets, page } = entry(stagingEnv, staticFile)
    const refused = await response
    expect(refused.status).toBe(401)
    expect(refused.headers.get('WWW-Authenticate')).toBe(stagingAccessChallenge)
    expect(assets).not.toHaveBeenCalled()
    expect(page).not.toHaveBeenCalled()
  })

  test('serves a static file from assets once the password passes, without its Authorization', async () => {
    const { response, page } = entry(stagingEnv, staticFile, withPassword)
    const passed = await response
    expect(passed.status).toBe(200)
    expect(passed.headers.get('Content-Type')).toBe('image/png')
    expect(passed.headers.get('Authorization-Seen')).toBe('false')
    expect(passed.headers.get('X-Robots-Tag')).toBeNull()
    expect(page).not.toHaveBeenCalled()
  })

  test('serves the page when no static file matches', async () => {
    const { response, assets } = entry(stagingEnv, '/recordings/', withPassword)
    const passed = await response
    expect(await passed.text()).toBe('page /recordings/')
    expect(assets).toHaveBeenCalledOnce()
  })

  test('sends only GET and HEAD to assets', async () => {
    const { response, assets } = entry(stagingEnv, staticFile, { ...withPassword, method: 'POST' })
    expect(await (await response).text()).toBe('page /welcome-icon.png')
    expect(assets).not.toHaveBeenCalled()
  })

  test('adds noindex to a static file served for the smoke test, after assets', async () => {
    const { response } = entry(stagingEnv, staticFile, { headers: { [smokeTestHeader]: '1' } })
    const exempt = await response
    expect(exempt.status).toBe(200)
    expect(exempt.headers.get('Content-Type')).toBe('image/png')
    expect(exempt.headers.get('X-Robots-Tag')).toBe(environmentNoindex)
  })

  test("never reads the Fixture Library from assets for the smoke test's header alone", async () => {
    for (const file of ['index.json', '090.wav']) {
      const path = `${fixtureLibraryPath}${file}`
      const { response, assets } = entry(stagingEnv, path, { headers: { [smokeTestHeader]: '1' } })
      expect((await response).status, path).toBe(401)
      expect(assets).not.toHaveBeenCalled()
      const withBoth = entry(stagingEnv, path, {
        headers: { [smokeTestHeader]: '1', Authorization: basic('pedos:stagingpassword') }
      })
      expect((await withBoth.response).status, path).toBe(200)
      expect(withBoth.assets).toHaveBeenCalledOnce()
    }
  })

  test('gates every environment but Production, and fails closed with no password variable', async () => {
    const outsideProduction: EntryEnv[] = [
      {},
      { STAGING_BASIC_AUTH_PASSWORD: password },
      { SITE_ENV: 'staging' },
      { SITE_ENV: 'Production', STAGING_BASIC_AUTH_PASSWORD: password }
    ]
    for (const env of outsideProduction) {
      expect((await entry(env, '/').response).status, JSON.stringify(env)).toBe(401)
    }
    expect((await entry({}, '/', withPassword).response).status).toBe(401)
    expect((await entry({ SITE_ENV: 'staging' }, '/', withPassword).response).status).toBe(401)
  })

  test('serves Production with no gate and no noindex, even given a wrong password', async () => {
    const withAndWithoutAWrongPassword: Record<string, string>[] = [
      {},
      { Authorization: basic('pedos:wrong') }
    ]
    for (const headers of withAndWithoutAWrongPassword) {
      const { response, assets, page } = entry({ SITE_ENV: 'production' }, '/', { headers })
      const served = await response
      expect(served.status).toBe(200)
      expect(served.headers.get('WWW-Authenticate')).toBeNull()
      expect(served.headers.get('X-Robots-Tag')).toBeNull()
      expect(served.headers.get('X-Page')).toBe('1')
      expect(assets).not.toHaveBeenCalled()
      expect(page.mock.calls[0]?.[0].headers.get('Authorization')).toBe(
        headers.Authorization ?? null
      )
    }
  })
})
