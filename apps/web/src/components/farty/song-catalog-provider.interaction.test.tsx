import { act } from 'react'
import { preload } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { catalogPath } from '@/lib/catalog/catalog-path.generated'
import { loadSongs } from '@/lib/catalog/load-songs'
import type { SongSummary } from '@/lib/catalog/song'
import { reportError } from '@/lib/telemetry/errors'
import { closeScreens, show } from '@/test-support/screen'
import { SongCatalogProvider, useSongCatalog } from './song-catalog-provider'

const page = vi.hoisted(() => ({ pathname: '/compose/' }))

vi.mock('next/navigation', () => ({ usePathname: () => page.pathname }))
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  preload: vi.fn()
}))
vi.mock('@/lib/catalog/load-songs', () => ({ loadSongs: vi.fn() }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))

const mary: SongSummary = {
  id: 'mary',
  title: 'Mary Had a Little Lamb',
  source: 'Public domain score · PDMX',
  bpm: 100,
  pitches: [60, 62, 64, 67],
  durations: [[1], [1], [1], [1]],
  notesPath: '/catalog/notes/mary.json'
}

let catalog: ReturnType<typeof useSongCatalog>

function Probe() {
  catalog = useSongCatalog()
  return null
}

afterEach(() => {
  closeScreens()
  page.pathname = '/compose/'
  vi.clearAllMocks()
})

it('names the Song Catalog in the page head, loads it once for the app, and finds a Song by its id', async () => {
  vi.mocked(loadSongs).mockResolvedValue([mary])
  await show(
    <SongCatalogProvider>
      <Probe />
    </SongCatalogProvider>
  )
  expect(preload).toHaveBeenCalledWith(catalogPath, { as: 'fetch', crossOrigin: 'anonymous' })
  expect(catalog.songs).toEqual([mary])
  expect(catalog.song('mary')?.title).toBe('Mary Had a Little Lamb')
  expect(catalog.song('twinkle')).toBeUndefined()
  expect(loadSongs).toHaveBeenCalledOnce()
})

it("reports a Song Catalog that didn't load, and loads it once the browser is back online", async () => {
  vi.mocked(loadSongs).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  vi.mocked(loadSongs).mockResolvedValue([mary])
  await show(
    <SongCatalogProvider>
      <Probe />
    </SongCatalogProvider>
  )
  expect(catalog.songs).toBeNull()
  expect(catalog.songsFailed).toBe(true)
  expect(catalog.song('mary')).toBeUndefined()
  expect(reportError).toHaveBeenCalledWith('catalog-load-failed', expect.any(TypeError))

  await act(async () => void window.dispatchEvent(new Event('online')))
  expect(catalog.songsFailed).toBe(false)
  expect(catalog.song('mary')?.title).toBe('Mary Had a Little Lamb')
  expect(loadSongs).toHaveBeenCalledTimes(2)
})

it('loads it again with Try again', async () => {
  vi.mocked(loadSongs).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  vi.mocked(loadSongs).mockResolvedValue([mary])
  await show(
    <SongCatalogProvider>
      <Probe />
    </SongCatalogProvider>
  )
  await act(async () => catalog.reloadSongs())
  expect(catalog.songs).toEqual([mary])
  expect(catalog.songsFailed).toBe(false)
})

it("doesn't fetch the Song Catalog on a shared Recording's public page", async () => {
  page.pathname = '/u/maya/r/8k2fq3m9x1ab/'
  await show(
    <SongCatalogProvider>
      <Probe />
    </SongCatalogProvider>
  )
  expect(loadSongs).not.toHaveBeenCalled()
  expect(preload).not.toHaveBeenCalled()
  expect(catalog.songs).toBeNull()
  expect(catalog.songsFailed).toBe(false)
})
