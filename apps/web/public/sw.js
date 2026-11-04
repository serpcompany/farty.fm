// Farty's service worker: it keeps the app shell, so an installed Farty opens offline.
//
// Every request it handles goes to the network first, so a deploy shows at once. The cache is
// only the fallback when there's no network, or when a deploy has taken an older build's file
// off the server. It holds pages, scripts, styles, fonts, images and the Song Catalog, never
// audio: Recordings live in IndexedDB, and the Fixture Library is never kept.
//
// It keeps one Song page, `/compose/song/`, not one per Song (#322): offline, it answers every
// Song's page, and shows the Song its address names from the kept catalog. It never keeps a Song's
// own page, even one loaded online: nothing would refresh it, so after a deploy it would load an
// older build's code and catalog, beside the current build's database.
//
// The catalog is an index, and each Song's notes are a file of their own, fetched as the Song
// opens (#323). The worker keeps notes in a cache of their own, so they never push the shell out.
// Once it has the index, it fetches every Song's notes it hasn't kept, in the background, so a
// Song never opened plays offline too (#138): once it's active after installing, and whenever a
// page or the start page's refresh fetches an index. Installing keeps only the shell, so a new
// deploy's worker takes over without waiting on a thousand Songs' notes (#350). Compose itself
// reads only the index.
//
// Bump `version` when the shell cache's contents change shape, and `notesVersion` when the notes
// cache's do. A new worker deletes every other version's caches when it activates.

const version = 2
const notesVersion = 1
// A few deploys' worth of the shell. The least recently fetched files go first.
const shell = { name: `pedos-shell-v${version}`, maxEntries: 200 }
// Two catalogs' notes, at a few KB a Song: at least `maxEntries`, and twice the Songs of the
// latest index the worker read, however large the catalog grows (`notesCap`). The least recently
// fetched go first, but never that index's own.
const songNotes = { name: `pedos-notes-v${notesVersion}`, maxEntries: 2000 }
const shellFile = /\.(?:js|css|woff2?|png|ico|svg|webp|jpg|webmanifest)$/i
// The Song Catalog's index and each Song's notes, named by their content
// (`src/lib/catalog/generate.ts`), so they never change under one name, as a build's scripts
// don't.
const catalogFile = /^\/catalog\/songs-[0-9a-f]+\.json$/
const notesFile = /^\/catalog\/notes\/[a-z0-9-]+-[0-9a-f]{16}\.json$/
// A Song's Song Creator, `/compose/<song>/`, and the page that answers for any of them offline.
// The pages beside it aren't Songs: the generator refuses their names as Song ids.
const songPage = /^\/compose\/([^/]+)\/?$/
const songShell = '/compose/song/'
const notSongs = new Set(['song', 'pad'])
// How often an online start page refreshes the tabs and their files, at most.
const refreshEvery = 5 * 60 * 1000
let lastRefresh = 0
// Each index whose Songs' notes this worker is keeping or has kept, so a page's every fetch of the
// index doesn't look again. Notes are named by their content, so an index's notes never change.
const notesKeptFor = new Map()
// How many Songs' notes it fetches at once, so they don't crowd out what a page fetches.
const notesAtOnce = 6
// The notes that the latest index the worker read names, which trimming never deletes.
let currentNotes = new Set()
// The indexes the shell's pages load, found as the worker installs, whose notes it fetches once
// it's active.
let installedIndexes = []

self.addEventListener('install', event => {
  event.waitUntil(
    precacheShell()
      .then(({ indexes }) => {
        installedIndexes = indexes
      })
      .finally(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  const activated = (async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('pedos-shell-') && name !== shell.name) await caches.delete(name)
      if (name.startsWith('pedos-notes-') && name !== songNotes.name) await caches.delete(name)
    }
    await self.clients.claim()
  })()
  event.waitUntil(activated)
  // Every Song's notes after that, without holding the activation, which would keep each page's
  // requests waiting until they're all fetched. Should the browser stop the worker part way, the
  // next fetch of the index fetches the rest.
  activated.then(() => keepNotesOf(installedIndexes)).catch(() => {})
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
  // Shared links and profile pages (ADR 0020, ADR 0021), at `/@<handle>/…` (#382): once a link is
  // stopped or taken down, no copy of its page opens. Their old `/u/<handle>/…` paths only
  // redirect to them, and no redirect is kept either.
  if (/^\/(?:@|%40|u\/)/i.test(url.pathname)) return false
  if (request.mode === 'navigate') return true
  if (catalogFile.test(url.pathname) || notesFile.test(url.pathname)) return true
  return url.pathname !== '/sw.js' && shellFile.test(url.pathname)
}

async function networkFirst(event) {
  const { request } = event
  const { pathname } = new URL(request.url)
  const opensSong = request.mode === 'navigate' && isSongPage(pathname)
  let response
  try {
    response = await fetch(request)
  } catch (offline) {
    // Offline, a Song's page is always the kept Song page, which the start page refreshes with
    // the tabs, so it runs the same build as they do.
    const kept = opensSong ? await keptSongShell() : await keptCopy(request)
    if (kept) return kept
    throw offline
  }
  // A tab opened before a deploy still loads its own build's scripts, such as a tab's code or
  // the render worker's, and its own Song Catalog and Songs' notes, and the deploy took them off
  // the server (#222). The copy kept from before answers instead of the 404. A build's files and
  // the catalog never change under the same name.
  if (
    response.status === 404 &&
    (pathname.startsWith('/_next/static/') ||
      catalogFile.test(pathname) ||
      notesFile.test(pathname))
  ) {
    const kept = await keptCopy(request)
    if (kept) return kept
  }
  if (keepable(response) && !opensSong) {
    event.waitUntil(keep(request.url, response.clone()))
    if (catalogFile.test(pathname)) {
      const index = response.clone()
      event.waitUntil(index.text().then(text => keepEveryNotes(pathname, text)))
    }
    if (request.mode === 'navigate' && pathname === '/') {
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

// The cache a file goes in: a Song's notes in their own, everything else in the shell's.
function storeFor(url) {
  return notesFile.test(new URL(url).pathname) ? songNotes : shell
}

async function keptCopy(request) {
  const cache = await caches.open(storeFor(request.url).name)
  return await cache.match(request.url, {
    ignoreVary: true,
    ignoreSearch: request.mode === 'navigate'
  })
}

// `/compose/<song>/` for a Song, not for a page beside the Songs, such as the Sound Pad.
function isSongPage(pathname) {
  const match = songPage.exec(pathname)
  return match !== null && !notSongs.has(match[1])
}

// The one Song page, which answers for every Song offline. It reads the Song from the address.
async function keptSongShell() {
  const cache = await caches.open(shell.name)
  return await cache.match(new URL(songShell, self.location.origin).href, { ignoreVary: true })
}

// Only a whole, same-origin success. That leaves out the Staging password's 401 (#123),
// redirects, and errors, so the cache never answers with one of them.
function keepable(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected
}

async function keep(url, response) {
  try {
    const store = storeFor(url)
    const cache = await caches.open(store.name)
    // Both workers load one script, each with its own chunks in the URL's fragment
    // (`#params=`), and a worker runs what its script's response URL says. So the copy is kept
    // with no URL of its own, and a worker started offline keeps the URL it asked for.
    const bare = new URL(url)
    bare.hash = ''
    await cache.put(bare.href, new Response(response.body, response))
    if (store === songNotes) await trim(cache, notesCap(), currentNotes)
    else await trim(cache, store.maxEntries)
  } catch {
    // A full disk only costs the offline copy.
  }
}

// The least recently fetched go first, except the paths in `spare`.
async function trim(cache, maxEntries, spare = new Set()) {
  const keys = await cache.keys()
  let over = keys.length - maxEntries
  for (const old of keys) {
    if (over <= 0) return
    if (spare.has(new URL(typeof old === 'string' ? old : old.url).pathname)) continue
    await cache.delete(old)
    over -= 1
  }
}

// Twice the latest index's Songs, so its notes and the last catalog's fit, and never fewer than
// `songNotes.maxEntries`.
function notesCap() {
  return Math.max(songNotes.maxEntries, 2 * currentNotes.size)
}

// Every Song's notes that each of `indexes`, `[path, text]`, names. Resolves to false when the
// network failed for any of them.
async function keepNotesOf(indexes) {
  let complete = true
  for (const [path, text] of indexes) {
    if (!(await keepEveryNotes(path, text))) complete = false
  }
  return complete
}

// Every Song's notes that the index at `path` names and the cache doesn't hold yet, fetched ahead,
// a few at a time. Resolves to false when the network failed for any of them, or the index's text
// isn't an index, such as the empty text of an index install couldn't fetch, and the next fetch of
// the index tries again.
function keepEveryNotes(path, indexText) {
  let keeping = notesKeptFor.get(path)
  if (!keeping) {
    keeping = fetchEveryNotes(indexText)
    notesKeptFor.set(path, keeping)
    keeping.then(complete => {
      if (!complete) notesKeptFor.delete(path)
    })
  }
  return keeping
}

async function fetchEveryNotes(indexText) {
  let paths = []
  try {
    const index = JSON.parse(indexText)
    if (Array.isArray(index)) {
      paths = index
        .map(song => song?.notesPath)
        .filter(notes => typeof notes === 'string' && notesFile.test(notes))
    }
  } catch {
    return false
  }
  if (paths.length > 0) currentNotes = new Set(paths)
  let complete = true
  try {
    const cache = await caches.open(songNotes.name)
    const kept = new Set(
      (await cache.keys()).map(key => new URL(typeof key === 'string' ? key : key.url).pathname)
    )
    const missing = paths.filter(notes => !kept.has(notes))
    const fetchNext = async () => {
      for (let notes = missing.shift(); notes !== undefined; notes = missing.shift()) {
        try {
          const response = await fetch(notes)
          // A 404 is notes a deploy took off the server: the next index names their successor.
          if (keepable(response)) {
            await cache.put(new URL(notes, self.location.origin).href, response)
          }
        } catch {
          complete = false
        }
      }
    }
    await Promise.all(Array.from({ length: notesAtOnce }, fetchNext))
    await trim(cache, notesCap(), currentNotes)
  } catch {
    // A full disk only costs the offline copies.
    complete = false
  }
  return complete
}

// Tabs open by client-side navigation, which this worker never keeps, so an online start page
// fetches the tabs and their files again. Each deploy's tabs, new ones too, then open offline.
async function refreshShell(startPage) {
  if (Date.now() - lastRefresh < refreshEvery) return
  lastRefresh = Date.now()
  let complete = false
  try {
    const kept = await precacheShell(await startPage.text())
    complete = (await keepNotesOf(kept.indexes)) && kept.complete
  } finally {
    // A connection lost part way leaves the cache partly refreshed, so the next start page tries
    // again instead of waiting.
    if (!complete) lastRefresh = 0
  }
}

// The start page, the pages it links to (the tabs), the pages in `/shell.json` (the one Song
// page among them), and the files they load, the Song Catalog's index too, so Farty opens
// offline right after it's installed, before any of them is fetched again. `startHtml` is the
// start page already fetched, if any. Resolves to `complete`, false when the network failed for
// any of them, and the `indexes` kept, `[path, text]`, whose Songs' notes the caller fetches.
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
  const indexes = []
  const texts = await Promise.all([...files].map(get))
  for (const [i, file] of [...files].entries()) {
    const text = texts[i]
    // An index it couldn't fetch is left to the next fetch of it, which keeps its notes then.
    if (text === null) continue
    if (catalogFile.test(file)) indexes.push([file, text])
    for (const [, path] of text.matchAll(/"(static\/chunks\/[^"\s\\]+\.js)"/g)) {
      if (!files.has(`/_next/${path}`)) loaded.add(`/_next/${path}`)
    }
  }
  await Promise.all([...loaded].map(get))
  return { complete, indexes }
}

// The pages a tab opens that the start page doesn't link to, such as the Song page that answers
// for every Song, from `/shell.json`. Throws when the network fails.
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
