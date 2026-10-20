// Pedos's service worker: it keeps the app shell, so an installed Pedos opens offline.
//
// Every request it handles goes to the network first, so a deploy shows at once. The cache is
// only the fallback when there's no network. It holds pages, scripts, styles, fonts and images,
// never audio: Recordings live in IndexedDB, and the Fixture Library is never kept.
//
// Bump `version` when the cache's contents change shape. A new worker deletes every other
// version's cache when it activates.

const version = 1
const cacheName = `pedos-shell-v${version}`
// A few deploys' worth of the shell. The least recently fetched files go first.
const maxEntries = 200
const shellFile = /\.(?:js|css|woff2?|png|ico|svg|webp|jpg|webmanifest)$/i

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
  // The Fixture Library is internal (AGENTS.md): never kept, even by a build that serves it.
  if (/(?:^|\/)fixtures\//.test(url.pathname)) return false
  if (request.mode === 'navigate') return true
  return url.pathname !== '/sw.js' && shellFile.test(url.pathname)
}

async function networkFirst(event) {
  const { request } = event
  let response
  try {
    response = await fetch(request)
  } catch (offline) {
    const cache = await caches.open(cacheName)
    const kept = await cache.match(request.url, {
      ignoreVary: true,
      ignoreSearch: request.mode === 'navigate'
    })
    if (kept) return kept
    throw offline
  }
  if (keepable(response)) event.waitUntil(keep(request.url, response.clone()))
  // The Staging password (#123) asked for credentials the browser no longer has, say after a
  // restart. A browser may not ask for them on a worker's behalf, so the worker steps aside, and
  // the next load asks for the password as usual and registers it again.
  if (request.mode === 'navigate' && response.status === 401) {
    event.waitUntil(self.registration.unregister())
  }
  return response
}

// Only a whole, same-origin success. That leaves out the Staging password's 401 (#123),
// redirects, and errors, so the cache never answers with one of them.
function keepable(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected
}

async function keep(url, response) {
  try {
    const cache = await caches.open(cacheName)
    await cache.put(url, response)
    const keys = await cache.keys()
    for (const old of keys.slice(0, Math.max(0, keys.length - maxEntries))) {
      await cache.delete(old)
    }
  } catch {
    // A full disk only costs the offline copy.
  }
}

// The start page, the pages it links to (the tabs), and the files they load, so Pedos opens
// offline right after it's installed, before any of them is fetched again.
async function precacheShell() {
  const pages = new Set(['/'])
  const files = new Set()
  for (const page of pages) {
    const html = await fetchAndKeep(page)
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
  await Promise.all([...files].map(fetchAndKeep))
}

async function fetchAndKeep(path) {
  try {
    const response = await fetch(path, { cache: 'no-cache' })
    if (!keepable(response)) return null
    await keep(new URL(path, self.location.origin).href, response.clone())
    return await response.text()
  } catch {
    return null
  }
}
