import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Song } from '@/lib/catalog/song'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { songs } from '@/lib/catalog/songs.generated'

// Song Creator loads the Song's notes as it opens (#323): the Song Catalog's index leaves them
// out. Offline, a Song never opened has none to play, so Song Creator says so with Try again.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const summary = songIndex[0]
const full = songs[0]

const page = vi.hoisted(() => ({
  loadSong: vi.fn<(song: unknown) => Promise<unknown>>(),
  makeToot: vi.fn<(song: Song) => Promise<never>>(),
  reportError: vi.fn()
}))

vi.mock('@/lib/catalog/load-songs', () => ({ loadSong: page.loadSong }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: page.reportError }))
vi.mock('./pedos-provider', () => ({
  tootPlayback: () => '',
  usePedos: () => ({
    songs: songIndex,
    songsFailed: false,
    reloadSongs: vi.fn(),
    song: (id: string) => songIndex.find(s => s.id === id),
    recordings: [],
    makeToot: page.makeToot,
    stopPlayback: () => undefined,
    forgetToot: () => undefined
  })
}))
vi.mock('./favorite-button', () => ({ FavoriteButton: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({}), usePathname: () => '/compose/' }))
vi.mock('@/lib/recording-store', () => ({}))
vi.mock('@/lib/toot-renderer', () => ({ TootError: class extends Error {} }))
vi.mock('@/lib/stale-build', () => ({ holdReload: () => undefined }))

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Making the Toot never finishes: these tests stop at which Song it was made from.
  page.makeToot.mockImplementation(() => new Promise<never>(() => undefined))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
})

async function open() {
  const { SongCreator } = await import('./song-creator')
  await act(async () => root?.render(<SongCreator id={summary.id} />))
}

it("makes the Toot from the Song's notes, once they've loaded", async () => {
  page.loadSong.mockResolvedValue(full)
  await open()
  expect(page.loadSong).toHaveBeenCalledWith(summary)
  expect(page.makeToot).toHaveBeenCalledOnce()
  expect(page.makeToot.mock.calls[0][0]).toBe(full)
  expect(container.textContent).toContain('Making your Toot')
})

it("says it couldn't load the Song, and tries again on Try again", async () => {
  page.loadSong.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  page.loadSong.mockResolvedValueOnce(full)
  await open()
  expect(container.textContent).toContain("Couldn't load this Song.")
  expect(page.reportError).toHaveBeenCalledWith('catalog-load-failed', expect.any(TypeError))
  expect(page.makeToot).not.toHaveBeenCalled()
  const tryAgain = [...container.querySelectorAll('button')].find(
    b => b.textContent === 'Try again'
  )
  await act(async () => tryAgain?.click())
  expect(page.loadSong).toHaveBeenCalledTimes(2)
  expect(page.makeToot.mock.calls[0][0]).toBe(full)
  expect(container.textContent).not.toContain("Couldn't load")
})
