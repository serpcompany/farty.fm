const version = 1
const cacheName = `pedos-shell-v${version}`
const maxKeptFiles = 200
const shellFile = /\.(?:js|css|woff2?|png|ico|svg|webp|jpg|webmanifest)$/i
const fixtureLibrary = /(?:^|\/)fixtures\//
const landerImages = '/lander/'
const buildAssets = '/_next/static/'
const shellRefreshIntervalMs = 5 * 60 * 1000
let lastShellRefresh = 0

self.addEventListener('install', event => {
  event.waitUntil(precacheShell().finally(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('pedos-shell-') && name !== cacheName) await caches.delete(name)
      }
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', event => {
  if (handles(event.request)) event.respondWith(networkFirst(event))
})

function handles(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  if (fixtureLibrary.test(url.pathname)) return false
  if (url.pathname.startsWith(landerImages)) return false
  if (request.mode === 'navigate') return true
  return url.pathname !== '/sw.js' && shellFile.test(url.pathname)
}

async function networkFirst(event) {
  const { request } = event
  const path = new URL(request.url).pathname
  let response
  try {
    response = await fetch(request)
  } catch (offline) {
    const kept = await keptCopy(request)
    if (kept) return kept
    throw offline
  }
  if (response.status === 404 && path.startsWith(buildAssets)) {
    const keptFromAnEarlierDeploy = await keptCopy(request)
    if (keptFromAnEarlierDeploy) return keptFromAnEarlierDeploy
  }
  if (keepable(response)) {
    event.waitUntil(keep(request.url, response.clone()))
    if (request.mode === 'navigate' && path === '/') {
      event.waitUntil(refreshShell(response.clone()))
    }
  }
  const askedForTheStagingPassword = request.mode === 'navigate' && response.status === 401
  if (askedForTheStagingPassword) event.waitUntil(self.registration.unregister())
  return response
}

async function keptCopy(request) {
  const cache = await caches.open(cacheName)
  return await cache.match(request.url, {
    ignoreVary: true,
    ignoreSearch: request.mode === 'navigate'
  })
}

function keepable(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected
}

async function keep(url, response) {
  try {
    const cache = await caches.open(cacheName)
    const withoutFragment = new URL(url)
    withoutFragment.hash = ''
    await cache.put(withoutFragment.href, new Response(response.body, response))
    const keys = await cache.keys()
    for (const oldest of keys.slice(0, Math.max(0, keys.length - maxKeptFiles))) {
      await cache.delete(oldest)
    }
  } catch {
    return
  }
}

async function refreshShell(startPage) {
  if (Date.now() - lastShellRefresh < shellRefreshIntervalMs) return
  lastShellRefresh = Date.now()
  let refreshedEverything = false
  try {
    refreshedEverything = await precacheShell(await startPage.text())
  } finally {
    if (!refreshedEverything) lastShellRefresh = 0
  }
}

async function precacheShell(startPageHtml) {
  let refreshedEverything = true
  const get = path =>
    fetchAndKeep(path).catch(() => {
      refreshedEverything = false
      return null
    })
  const pages = new Set(['/'])
  try {
    for (const page of await pagesFromShellManifest()) pages.add(page)
  } catch {
    refreshedEverything = false
  }
  const files = new Set()
  for (const page of pages) {
    const html = page === '/' && startPageHtml !== undefined ? startPageHtml : await get(page)
    if (html === null) continue
    for (const [, path] of html.matchAll(/<a\b[^>]*\bhref="(\/[^"?#]*)"/g)) {
      if (page === '/' && !shellFile.test(path) && !path.startsWith('/_next/')) pages.add(path)
    }
    for (const [, path] of html.matchAll(/["'(](\/[^"'()\s\\<>]+)/g)) {
      if (handles({ method: 'GET', url: new URL(path, self.location.origin).href })) {
        files.add(path)
      }
    }
  }
  const scriptsTheyLoad = new Set()
  for (const text of await Promise.all([...files].map(get))) {
    for (const [, path] of (text ?? '').matchAll(/"(static\/chunks\/[^"\s\\]+\.js)"/g)) {
      if (!files.has(`/_next/${path}`)) scriptsTheyLoad.add(`/_next/${path}`)
    }
  }
  await Promise.all([...scriptsTheyLoad].map(get))
  return refreshedEverything
}

async function pagesFromShellManifest() {
  const response = await fetch('/shell.json', { cache: 'no-cache' })
  if (!keepable(response)) return []
  try {
    const { pages } = await response.json()
    return Array.isArray(pages)
      ? pages.filter(page => typeof page === 'string' && page.startsWith('/'))
      : []
  } catch {
    return []
  }
}

async function fetchAndKeep(path) {
  const response = await fetch(path, { cache: 'no-cache' })
  if (!keepable(response)) return null
  await keep(new URL(path, self.location.origin).href, response.clone())
  return await response.text()
}
