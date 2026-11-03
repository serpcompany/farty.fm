import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { catalogPath } from './catalog-path.generated'
import { songs } from './songs.generated'

// Each test imports the loader afresh, so none shares another's fetch.
async function loader() {
  vi.resetModules()
  return await import('./load-songs')
}

const fetch = vi.fn<typeof globalThis.fetch>()

beforeEach(() => {
  fetch.mockReset()
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadSongs', () => {
  test("fetches this build's catalog once, for every caller", async () => {
    fetch.mockResolvedValue(Response.json(songs))
    const { loadSongs } = await loader()
    const [one, two] = await Promise.all([loadSongs(), loadSongs()])
    expect(one).toEqual(songs)
    expect(two).toBe(one)
    expect(await loadSongs()).toBe(one)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(catalogPath)
  })

  test('tries again after a failed fetch', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetch.mockResolvedValueOnce(Response.json(songs))
    const { loadSongs } = await loader()
    await expect(loadSongs()).rejects.toThrow('Failed to fetch')
    expect(await loadSongs()).toEqual(songs)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('refuses an answer that is an error, or not a list of Songs', async () => {
    fetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    fetch.mockResolvedValueOnce(Response.json({ songs }))
    const { loadSongs } = await loader()
    await expect(loadSongs()).rejects.toThrow(/answered 404/)
    await expect(loadSongs()).rejects.toThrow(/isn't a list/)
  })
})
