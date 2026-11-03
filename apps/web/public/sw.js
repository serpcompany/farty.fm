const version = 2
const notesVersion = 1
const shell = { name: `pedos-shell-v${version}`, maxKeptFiles: 200 }
const songNotes = { name: `pedos-notes-v${notesVersion}`, maxKeptFiles: 2000 }
const shellFile = /\.(?:js|css|woff2?|png|ico|svg|webp|jpg|webmanifest)$/i
const catalogFile = /^\/catalog\/songs-[0-9a-f]+\.json$/
const notesFile = /^\/catalog\/notes\/[a-z0-9-]+-[0-9a-f]{16}\.json$/
const songPage = /^\/compose\/([^/]+)\/?$/
const songShell = '/compose/song/'
const pagesBesideTheSongs = new Set(['song', 'pad'])
const fixtureLibrary = /(?:^|\/)fixtures\//
const landerImages = '/lander/'
const sharedLinks = '/u/'
const buildAssets = '/_next/static/'
const shellRefreshIntervalMs = 5 * 60 * 1000
let lastShellRefresh = 0
const notesKeptForIndex = new Map()
const notesFetchedAtOnce = 6
let notesOfTheLatestIndex = new Set()
let indexesFoundOnInstall = []

self.addEventListener('install', event => {
  event.waitUntil(
    precacheShell()
      .then(({ catalogIndexes }) => {
        indexesFoundOnInstall = catalogIndexes
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
  activated.then(() => keepEveryNotesOf(indexesFoundOnInstall)).catch(() => {})
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
  if (url.pathname.startsWith(sharedLinks)) return false
  if (request.mode === 'navigate') return true
  if (isCatalogData(url.pathname)) return true
  return url.pathname !== '/sw.js' && shellFile.test(url.pathname)
}

function isCatalogData(path) {
  return catalogFile.test(path) || notesFile.test(path)
}

async function networkFirst(event) {
  const { request } = event
  const path = new URL(request.url).pathname
  const opensASong = request.mode === 'navigate' && isSongPage(path)
  let response
  try {
    response = await fetch(request)
  } catch (offline) {
    const kept = opensASong ? await keptSongShell() : await keptCopy(request)
    if (kept) return kept
    throw offline
  }
  if (response.status === 404 && (path.startsWith(buildAssets) || isCatalogData(path))) {
    const keptFromAnEarlierDeploy = await keptCopy(request)
    if (keptFromAnEarlierDeploy) return keptFromAnEarlierDeploy
  }
  if (keepable(response) && !opensASong) {
    event.waitUntil(keep(request.url, response.clone()))
    if (catalogFile.test(path)) {
      const index = response.clone()
      event.waitUntil(index.text().then(text => keepEveryNotes(path, text)))
    }
    if (request.mode === 'navigate' && path === '/') {
      event.waitUntil(refreshShell(response.clone()))
    }
  }
  const askedForTheStagingPassword = request.mode === 'navigate' && response.status === 401
  if (askedForTheStagingPassword) event.waitUntil(self.registration.unregister())
  return response
}

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

function isSongPage(path) {
  const match = songPage.exec(path)
  return match !== null && !pagesBesideTheSongs.has(match[1])
}

async function keptSongShell() {
  const cache = await caches.open(shell.name)
  return await cache.match(new URL(songShell, self.location.origin).href, { ignoreVary: true })
}

function keepable(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected
}

async function keep(url, response) {
  try {
    const store = storeFor(url)
    const cache = await caches.open(store.name)
    const withoutFragment = new URL(url)
    withoutFragment.hash = ''
    await cache.put(withoutFragment.href, new Response(response.body, response))
    if (store === songNotes) await dropTheOldest(cache, maxKeptNotes(), notesOfTheLatestIndex)
    else await dropTheOldest(cache, store.maxKeptFiles)
  } catch {
    return
  }
}

async function dropTheOldest(cache, maxKeptFiles, spare = new Set()) {
  const keys = await cache.keys()
  let over = keys.length - maxKeptFiles
  for (const oldest of keys) {
    if (over <= 0) return
    if (spare.has(new URL(typeof oldest === 'string' ? oldest : oldest.url).pathname)) continue
    await cache.delete(oldest)
    over -= 1
  }
}

function maxKeptNotes() {
  return Math.max(songNotes.maxKeptFiles, 2 * notesOfTheLatestIndex.size)
}

async function keepEveryNotesOf(catalogIndexes) {
  let keptEverything = true
  for (const [path, text] of catalogIndexes) {
    if (!(await keepEveryNotes(path, text))) keptEverything = false
  }
  return keptEverything
}

function keepEveryNotes(indexPath, indexText) {
  let keeping = notesKeptForIndex.get(indexPath)
  if (!keeping) {
    keeping = fetchEveryNotes(indexText)
    notesKeptForIndex.set(indexPath, keeping)
    keeping.then(keptEverything => {
      if (!keptEverything) notesKeptForIndex.delete(indexPath)
    })
  }
  return keeping
}

function notesPathsIn(indexText) {
  try {
    const index = JSON.parse(indexText)
    if (!Array.isArray(index)) return []
    return index
      .map(song => song?.notesPath)
      .filter(notes => typeof notes === 'string' && notesFile.test(notes))
  } catch {
    return null
  }
}

async function fetchEveryNotes(indexText) {
  const paths = notesPathsIn(indexText)
  if (paths === null) return false
  if (paths.length > 0) notesOfTheLatestIndex = new Set(paths)
  let keptEverything = true
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
          if (keepable(response)) {
            await cache.put(new URL(notes, self.location.origin).href, response)
          }
        } catch {
          keptEverything = false
        }
      }
    }
    await Promise.all(Array.from({ length: notesFetchedAtOnce }, fetchNext))
    await dropTheOldest(cache, maxKeptNotes(), notesOfTheLatestIndex)
  } catch {
    keptEverything = false
  }
  return keptEverything
}

async function refreshShell(startPage) {
  if (Date.now() - lastShellRefresh < shellRefreshIntervalMs) return
  lastShellRefresh = Date.now()
  let refreshedEverything = false
  try {
    const kept = await precacheShell(await startPage.text())
    refreshedEverything = (await keepEveryNotesOf(kept.catalogIndexes)) && kept.refreshedEverything
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
  const catalogIndexes = []
  const texts = await Promise.all([...files].map(get))
  for (const [i, file] of [...files].entries()) {
    const text = texts[i]
    if (text === null) continue
    if (catalogFile.test(file)) catalogIndexes.push([file, text])
    for (const [, path] of text.matchAll(/"(static\/chunks\/[^"\s\\]+\.js)"/g)) {
      if (!files.has(`/_next/${path}`)) scriptsTheyLoad.add(`/_next/${path}`)
    }
  }
  await Promise.all([...scriptsTheyLoad].map(get))
  return { refreshedEverything, catalogIndexes }
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
