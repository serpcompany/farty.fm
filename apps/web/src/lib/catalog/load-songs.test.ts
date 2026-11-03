import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { songs } from '../../test-support/songs.generated'
import { catalogPath } from './catalog-path.generated'
import { songIndex } from './song-index.generated'

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
    fetch.mockResolvedValue(Response.json(songIndex))
    const { loadSongs } = await loader()
    const [one, two] = await Promise.all([loadSongs(), loadSongs()])
    expect(one).toEqual(songIndex)
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

describe('loadSong (#323)', () => {
  const [twinkle, mary] = songIndex
  const notesOf = (id: string) => {
    const song = songs.find(s => s.id === id)
    if (!song) throw new Error(`No Song ${id}`)
    const { bar_lines, length_beats, notes } = song
    return { bar_lines, length_beats, notes }
  }

  test("fetches a Song's notes once, as it opens, for every caller", async () => {
    fetch.mockImplementation(async path =>
      Response.json(notesOf(path === twinkle.notesPath ? 'twinkle' : 'mary'))
    )
    const { loadSong } = await loader()
    const [one, two] = await Promise.all([loadSong(twinkle), loadSong(twinkle)])
    expect(one).toEqual(songs[0])
    expect(two).toBe(one)
    expect(await loadSong(mary)).toEqual(songs[1])
    expect(await loadSong(twinkle)).toBe(one)
    expect(fetch.mock.calls).toEqual([[twinkle.notesPath], [mary.notesPath]])
  })

  test('tries again after a failed fetch, and refuses notes that are not a melody', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    fetch.mockResolvedValueOnce(Response.json({ notes: 'none' }))
    fetch.mockResolvedValueOnce(Response.json(notesOf('twinkle')))
    const { loadSong } = await loader()
    await expect(loadSong(twinkle)).rejects.toThrow('Failed to fetch')
    await expect(loadSong(twinkle)).rejects.toThrow(/notes answered 404/)
    await expect(loadSong(twinkle)).rejects.toThrow(/aren't a melody/)
    expect(await loadSong(twinkle)).toEqual(songs[0])
  })
})
