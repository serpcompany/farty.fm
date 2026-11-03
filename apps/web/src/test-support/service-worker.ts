import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
export const origin = 'https://farty.test'

type Network = (url: string) => Response | 'offline' | Promise<Response>
type Listener = (event: unknown) => void

export function ok(body = ''): Response {
  const response = new Response(body, { status: 200 })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

export function failed(status: number): Response {
  const response = new Response('Something went wrong', { status })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

export function locked(): Response {
  const response = new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Staging"' }
  })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

export function startWorker(network: Network) {
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

  const kept = (name = 'pedos-shell-v2') =>
    [...(stores.get(name)?.keys() ?? [])].map(url => url.replace(origin, ''))

  return { lifecycle, request, kept, caches, registration }
}

export const catalog = '/catalog/songs-3cfb06831b9e44c0.json'

export const startPage = `<html><head>
<link rel="icon" href="/icon.png?a1b2" sizes="512x512">
<script src="/_next/static/chunks/main.js" async></script>
<link rel="stylesheet" href="/_next/static/css/app.css">
</head><body><nav><a href="/recordings/">Recordings</a><a href="/">Record</a></nav>
<picture><source media="(min-width: 48rem)" srcSet="/lander/song.webp"/><img src="data:image/gif;base64,R0lGOD"></picture>
<script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/page.js\\"]"])</script>
</body></html>`
