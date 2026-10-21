// Farty's service worker: it keeps the app shell, so an installed Farty opens offline.
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
// How often an online start page refreshes the tabs and their files, at most.
const refreshEvery = 5 * 60 * 1000
let lastRefresh = 0

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
  // The lander's images (#191): only a desktop that hasn't opened Farty shows them, and never
  // offline, so the worker neither precaches them from `/`'s markup nor keeps them. Phones never
  // download them.
  if (url.pathname.startsWith('/lander/')) return false
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
  if (keepable(response)) {
    event.waitUntil(keep(request.url, response.clone()))
    if (request.mode === 'navigate' && new URL(request.url).pathname === '/') {
      event.waitUntil(refreshShell(response.clone()))
    }
  }
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
    // Both workers load one script, each with its own chunks in the URL's fragment
    // (`#params=`), and a worker runs what its script's response URL says. So the copy is kept
    // with no URL of its own, and a worker started offline keeps the URL it asked for.
    const bare = new URL(url)
    bare.hash = ''
    await cache.put(bare.href, new Response(response.body, response))
    const keys = await cache.keys()
    for (const old of keys.slice(0, Math.max(0, keys.length - maxEntries))) {
      await cache.delete(old)
    }
  } catch {
    // A full disk only costs the offline copy.
  }
}

// Tabs open by client-side navigation, which this worker never keeps, so an online start page
// fetches the tabs and their files again. Each deploy's tabs, new ones too, then open offline.
async function refreshShell(startPage) {
  if (Date.now() - lastRefresh < refreshEvery) return
  lastRefresh = Date.now()
  let complete = false
  try {
    complete = await precacheShell(await startPage.text())
  } finally {
    // A connection lost part way leaves the cache partly refreshed, so the next start page tries
    // again instead of waiting.
    if (!complete) lastRefresh = 0
  }
}

// The start page, the pages it links to (the tabs), each Song's page (`/shell.json`), and the
// files they load, so Farty opens offline right after it's installed, before any of them is
// fetched again. `startHtml` is the start page already fetched, if any. Resolves to false when
// the network failed for any of them.
async function precacheShell(startHtml) {
  let complete = true
  const get = path =>
    fetchAndKeep(path).catch(() => {
      complete = false
      return null
    })
  const pages = new Set(['/'])
  try {
    for (const page of await laterPages()) pages.add(page)
  } catch {
    complete = false
  }
  const files = new Set()
  for (const page of pages) {
    const html = page === '/' && startHtml !== undefined ? startHtml : await get(page)
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
  // The scripts load more scripts by name, such as the render and analysis workers' own, which
  // Song Creator and Record need offline too.
  const loaded = new Set()
  for (const text of await Promise.all([...files].map(get))) {
    for (const [, path] of (text ?? '').matchAll(/"(static\/chunks\/[^"\s\\]+\.js)"/g)) {
      if (!files.has(`/_next/${path}`)) loaded.add(`/_next/${path}`)
    }
  }
  await Promise.all([...loaded].map(get))
  return complete
}

// The pages a tab opens that the start page doesn't link to, such as each Song's Song Creator,
// from `/shell.json`. Throws when the network fails.
async function laterPages() {
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

// Throws when the network fails. Resolves to null for a response that isn't kept.
async function fetchAndKeep(path) {
  const response = await fetch(path, { cache: 'no-cache' })
  if (!keepable(response)) return null
  await keep(new URL(path, self.location.origin).href, response.clone())
  return await response.text()
}
