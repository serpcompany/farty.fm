import { catalogPath } from './catalog-path.generated'
import type { Song } from './song'

// The Song Catalog in the browser (#322): fetched as data, not compiled into the JavaScript, so
// the app stays the same size however many Songs ship. Its file is named by its content, so this
// build only ever reads its own catalog, and the service worker keeps it for offline use
// (public/sw.js).

let loading: Promise<readonly Song[]> | null = null

/**
 * The Songs this build ships, in the ship list's order: fetched once and shared. A failed fetch
 * isn't kept, so the next call tries again.
 */
export function loadSongs(): Promise<readonly Song[]> {
  loading ??= fetchSongs().catch(error => {
    loading = null
    throw error
  })
  return loading
}

async function fetchSongs(): Promise<readonly Song[]> {
  const response = await fetch(catalogPath)
  if (!response.ok) throw new Error(`The Song Catalog answered ${response.status}`)
  const songs: unknown = await response.json()
  if (!Array.isArray(songs)) throw new Error("The Song Catalog isn't a list")
  return songs as readonly Song[]
}
