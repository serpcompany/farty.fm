import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const origin = 'https://pedos.test'

type Network = (url: string) => Response | 'offline'
type Listener = (event: unknown) => void

function ok(body = ''): Response {
  const response = new Response(body, { status: 200 })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

function failed(status: number): Response {
  const response = new Response('Something went wrong', { status })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

function locked(): Response {
  const response = new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Staging"' }
  })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

function startWorker(network: Network) {
  const listeners: Record<string, Listener> = {}
  const stores = new Map<string, Map<string, Response>>()
  const cacheFor = (entries: Map<string, Response>) => ({
    async put(url: string, response: Response) {
      entries.delete(url)
      entries.set(url, response)
    },
    async match(url: string, options?: { ignoreSearch?: boolean }) {
      const bare = (key: string) => (options?.ignoreSearch ? key.split('?')[0] : key.split('#')[0])
      const key = [...entries.keys()].find(k => bare(k) === bare(url))
      return key ? entries.get(key)?.clone() : undefined
    },
    async keys() {
      return [...entries.keys()]
    },
    async delete(url: string) {
      return entries.delete(url)
    }
  })
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      return cacheFor(stores.get(name) as Map<string, Response>)
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name: string) {
      return stores.delete(name)
    }
  }
  async function fetch(input: string | { url: string }) {
    const result = network(new URL(typeof input === 'string' ? input : input.url, origin).href)
    if (result === 'offline') throw new TypeError('Failed to fetch')
    return result
  }
  const registration = { unregistered: false }
  const self = {
    location: new URL(`${origin}/sw.js`),
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: {
      unregister: async () => {
        registration.unregistered = true
        return true
      }
    }
  }
  runInNewContext(source, { self, caches, fetch, URL, Response, console })

  async function lifecycle(type: 'install' | 'activate') {
    let done: unknown
    listeners[type]({ waitUntil: (promise: unknown) => (done = promise) })
    await done
  }

  async function request(path: string, init: { mode?: string; method?: string } = {}) {
    let answer: Promise<Response> | undefined
    const kept: Promise<unknown>[] = []
    listeners.fetch({
      request: { url: new URL(path, origin).href, method: init.method ?? 'GET', mode: init.mode },
      respondWith: (promise: Promise<Response>) => (answer = promise),
      waitUntil: (promise: Promise<unknown>) => kept.push(promise)
    })
    if (!answer) return undefined
    const response = await answer
    await Promise.all(kept)
    return response
  }

  const kept = (name = 'pedos-shell-v1') =>
    [...(stores.get(name)?.keys() ?? [])].map(url => url.replace(origin, ''))

  return { lifecycle, request, kept, caches, registration }
}

const startPage = `<html><head>
<link rel="icon" href="/icon.png?a1b2" sizes="512x512">
<script src="/_next/static/chunks/main.js" async></script>
<link rel="stylesheet" href="/_next/static/css/app.css">
</head><body><nav><a href="/recordings/">Recordings</a><a href="/">Record</a></nav>
<picture><source media="(min-width: 48rem)" srcSet="/lander/song.webp"/><img src="data:image/gif;base64,R0lGOD"></picture>
<script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/page.js\\"]"])</script>
</body></html>`

describe('the service worker', () => {
  it("keeps the start page, the tabs it links to, and the files they load when it installs, but not the lander's images", async () => {
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (path === '/') return ok(startPage)
      if (path === '/recordings/') return ok('<script src="/_next/static/chunks/recordings.js">')
      return ok('file')
    })
    await worker.lifecycle('install')
    expect(worker.kept().sort()).toEqual([
      '/',
      '/_next/static/chunks/main.js',
      '/_next/static/chunks/page.js',
      '/_next/static/chunks/recordings.js',
      '/_next/static/css/app.css',
      '/icon.png?a1b2',
      '/recordings/'
    ])
  })

  it("keeps each Song's page from /shell.json, and the files it loads, when it installs", async () => {
    let online = true
    const worker = startWorker(url => {
      if (!online) return 'offline'
      const path = url.replace(origin, '')
      if (path === '/') return ok(startPage)
      if (path === '/shell.json') return ok(JSON.stringify({ pages: ['/compose/mary/'] }))
      if (path === '/compose/mary/') {
        return ok('<script src="/_next/static/chunks/song.js"></script>Mary')
      }
      return ok('file')
    })
    await worker.lifecycle('install')
    expect(worker.kept()).toEqual(
      expect.arrayContaining(['/compose/mary/', '/_next/static/chunks/song.js'])
    )
    expect(worker.kept()).not.toContain('/shell.json')

    online = false
    expect(await (await worker.request('/compose/mary/', { mode: 'navigate' }))?.text()).toContain(
      'Mary'
    )
    expect(await (await worker.request('/_next/static/chunks/song.js'))?.text()).toBe('file')
  })

  it("keeps the scripts that the scripts load by name, such as the workers' chunks", async () => {
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (path === '/') return ok(startPage)
      if (path === '/_next/static/chunks/page.js') {
        return ok('new Worker(url, ["static/chunks/render-a.js","static/chunks/render-b.js"])')
      }
      return ok('file')
    })
    await worker.lifecycle('install')
    expect(worker.kept()).toEqual(
      expect.arrayContaining([
        '/_next/static/chunks/render-a.js',
        '/_next/static/chunks/render-b.js'
      ])
    )
  })

  it('answers a worker script offline with a copy that has no URL, so each worker keeps its own', async () => {
    let online = true
    const worker = startWorker(url => {
      if (!online) return 'offline'
      const response = ok(`script for ${url}`)
      Object.defineProperty(response, 'url', { value: url })
      return response
    })
    const script = '/_next/static/chunks/turbopack-worker.js'
    await worker.request(`${script}#params=analysis`)
    expect(worker.kept()).toEqual([script])

    online = false
    const offline = await worker.request(`${script}#params=render`)
    expect(offline?.url).toBe('')
    expect(await offline?.text()).toBe(`script for ${origin}${script}#params=analysis`)
  })

  it('tries the refresh again when /shell.json fails to load', async () => {
    let dropped = true
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (path === '/') return ok(startPage)
      if (path === '/shell.json') {
        return dropped ? 'offline' : ok(JSON.stringify({ pages: ['/compose/mary/'] }))
      }
      return ok('file')
    })
    await worker.request('/', { mode: 'navigate' })
    expect(worker.kept()).not.toContain('/compose/mary/')
    dropped = false
    await worker.request('/', { mode: 'navigate' })
    expect(worker.kept()).toContain('/compose/mary/')
  })

  it('fetches pages from the network first, and answers from the cache offline', async () => {
    let online = true
    let deploy = 'first deploy'
    const worker = startWorker(() => (online ? ok(deploy) : 'offline'))

    expect(await (await worker.request('/', { mode: 'navigate' }))?.text()).toBe('first deploy')
    deploy = 'second deploy'
    expect(await (await worker.request('/', { mode: 'navigate' }))?.text()).toBe('second deploy')

    online = false
    expect(await (await worker.request('/', { mode: 'navigate' }))?.text()).toBe('second deploy')
    expect(await (await worker.request('/?source=home', { mode: 'navigate' }))?.text()).toBe(
      'second deploy'
    )
    await expect(worker.request('/recordings/', { mode: 'navigate' })).rejects.toThrow(
      'Failed to fetch'
    )
    expect(worker.registration.unregistered).toBe(false)
  })

  it("answers an older build's script with the copy it kept, once a deploy has taken it off the server", async () => {
    let deployed = false
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (deployed && path.startsWith('/_next/static/')) return failed(404)
      return ok(`first build's ${path}`)
    })
    const chunk = '/_next/static/chunks/toots-a1b2.js'
    await worker.request(chunk)
    await worker.request('/_next/static/chunks/turbopack-worker.js#params=render')

    deployed = true
    const answer = await worker.request(chunk)
    expect(answer?.status).toBe(200)
    expect(await answer?.text()).toBe(`first build's ${chunk}`)
    const script = await worker.request('/_next/static/chunks/turbopack-worker.js#params=song')
    expect(await script?.text()).toBe(
      "first build's /_next/static/chunks/turbopack-worker.js#params=render"
    )
    expect((await worker.request('/_next/static/chunks/never-loaded.js'))?.status).toBe(404)
  })

  it("leaves a 404 outside the build's own files to the server", async () => {
    let gone = false
    const worker = startWorker(url => (gone ? failed(404) : ok(`kept ${url.replace(origin, '')}`)))
    await worker.request('/compose/mary/', { mode: 'navigate' })
    await worker.request('/icon.png')
    gone = true
    expect((await worker.request('/compose/mary/', { mode: 'navigate' }))?.status).toBe(404)
    expect((await worker.request('/icon.png'))?.status).toBe(404)
  })

  it("keeps a later deploy's tabs, new and changed, after one online visit to the start page", async () => {
    let online = true
    let deploy: Record<string, string> = {
      '/': startPage,
      '/recordings/': '<script src="/_next/static/chunks/recordings-a.js"></script>A recordings'
    }
    const worker = startWorker(url => {
      if (!online) return 'offline'
      const page = deploy[url.replace(origin, '')]
      return page === undefined ? ok('file') : ok(page)
    })
    await worker.lifecycle('install')

    deploy = {
      '/': startPage.replace(
        '<a href="/">Record</a>',
        '<a href="/">Record</a><a href="/songs/">Songs</a>'
      ),
      '/recordings/': '<script src="/_next/static/chunks/recordings-b.js"></script>B recordings',
      '/songs/': '<script src="/_next/static/chunks/songs-b.js"></script>B songs'
    }
    await worker.request('/', { mode: 'navigate' })

    online = false
    const offline = async (path: string, mode?: string) =>
      (await worker.request(path, { mode }))?.text()
    expect(await offline('/songs/', 'navigate')).toContain('B songs')
    expect(await offline('/recordings/', 'navigate')).toContain('B recordings')
    expect(await offline('/_next/static/chunks/songs-b.js')).toBe('file')
    expect(await offline('/_next/static/chunks/recordings-b.js')).toBe('file')
  })

  it('tries the refresh again on the next start page when the connection drops part way', async () => {
    let dropped = true
    const worker = startWorker(url => {
      const path = url.replace(origin, '')
      if (path === '/') return ok(startPage)
      if (path === '/recordings/') return dropped ? 'offline' : ok('B recordings')
      return ok('file')
    })
    await worker.request('/', { mode: 'navigate' })
    expect(worker.kept()).not.toContain('/recordings/')

    dropped = false
    await worker.request('/', { mode: 'navigate' })
    expect(worker.kept()).toContain('/recordings/')
  })

  it('stays registered when a page load fails with a 403 or a 500', async () => {
    for (const status of [403, 500]) {
      const worker = startWorker(() => failed(status))
      expect((await worker.request('/', { mode: 'navigate' }))?.status).toBe(status)
      expect(worker.kept()).toEqual([])
      expect(worker.registration.unregistered, String(status)).toBe(false)
    }
  })

  it('never keeps a response from the Staging password', async () => {
    let online = true
    const worker = startWorker(() => (online ? locked() : 'offline'))
    await worker.lifecycle('install')
    expect((await worker.request('/_next/static/chunks/main.js'))?.status).toBe(401)
    expect(worker.registration.unregistered).toBe(false)
    expect((await worker.request('/', { mode: 'navigate' }))?.status).toBe(401)
    expect(worker.kept()).toEqual([])
    expect(worker.registration.unregistered).toBe(true)

    online = false
    await expect(worker.request('/', { mode: 'navigate' })).rejects.toThrow('Failed to fetch')
  })

  it('leaves the Fixture Library, audio, data, other sites and writes to the network', async () => {
    const worker = startWorker(() => ok('file'))
    for (const path of [
      '/fixtures/recordings/090__carlosramon__17-pet__186119.wav',
      '/fixtures/recordings/cover.png',
      '/lander/song.webp',
      '/_next/static/media/fart.wav',
      '/catalog/songs.json',
      '/sw.js',
      'https://elsewhere.test/script.js'
    ]) {
      expect(await worker.request(path), path).toBeUndefined()
    }
    expect(await worker.request('/', { mode: 'navigate', method: 'POST' })).toBeUndefined()
    expect(worker.kept()).toEqual([])
  })

  it("deletes the other versions' caches when a new worker activates", async () => {
    const worker = startWorker(() => ok())
    await worker.caches.open('pedos-shell-v0')
    await worker.caches.open('pedos-shell-v1')
    await worker.caches.open('someone-elses-cache')
    await worker.lifecycle('activate')
    expect(await worker.caches.keys()).toEqual(['pedos-shell-v1', 'someone-elses-cache'])
  })
})
