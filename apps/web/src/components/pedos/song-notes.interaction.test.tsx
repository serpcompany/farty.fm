import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/lib/catalog/song'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { songs } from '@/lib/catalog/songs.generated'
import type { SongToot } from '@/lib/toot'

// Song Creator loads the Song's notes as it opens (#323): the Song Catalog's index leaves them
// out. Offline, a Song never opened has none to play, so Song Creator says so with Try again.
// A saved Toot's screen plays the Toot's own audio, so its Play never waits on the notes.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const summary = songIndex[0]
const full = songs[0]

/** A saved Toot of the first Song, its audio on this device. */
const saved: SongToot = {
  id: 'toot-1',
  title: summary.title,
  createdAt: 0,
  seconds: 12,
  songId: summary.id,
  arrangement: { transposition: 0, recordingForPitch: {} }
}

const page = vi.hoisted(() => ({
  loadSong: vi.fn<(song: unknown) => Promise<unknown>>(),
  makeToot: vi.fn<(song: Song) => Promise<never>>(),
  toggleTootPlayback: vi.fn(),
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
    recording: () => undefined,
    makeToot: page.makeToot,
    toots: [saved],
    toot: (id: string) => (id === saved.id ? saved : undefined),
    tootsFailed: false,
    nowPlaying: null,
    playbackStartedAt: null,
    tootPlayFailed: null,
    toggleTootPlayback: page.toggleTootPlayback,
    stopPlayback: () => undefined,
    forgetToot: () => undefined
  })
}))
vi.mock('./favorite-button', () => ({ FavoriteButton: () => null }))
// No Song has Fart Choices (#360): every Toot is automatic.
vi.mock('./use-fart-choices', () => ({
  useFartChoices: () => new Map(),
  changeFartChoices: vi.fn()
}))
vi.mock('./share-recording', () => ({ ShareButton: () => null, useShares: () => null }))
vi.mock('./toots-screen', () => ({
  TootMenu: () => null,
  RenameTootDialog: () => null,
  DeleteTootDialog: () => null
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/compose/',
  useSearchParams: () => new URLSearchParams({ id: 'toot-1' })
}))
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

describe("a saved Toot's screen", () => {
  async function openToot() {
    const { TootScreen } = await import('./toot-screen')
    await act(async () => root?.render(<TootScreen />))
  }

  const play = () => container.querySelector<HTMLButtonElement>('[data-testid="song-creator-play"]')

  it("plays the Toot while its Song's notes are still loading", async () => {
    page.loadSong.mockImplementation(() => new Promise<never>(() => undefined))
    await openToot()
    expect(container.textContent).toContain(summary.source)
    expect(play()?.disabled).toBe(false)
    await act(async () => play()?.click())
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(saved)
  })

  it("plays the Toot when its Song's notes fail to load, and offers Try again for them", async () => {
    page.loadSong.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    page.loadSong.mockResolvedValueOnce(full)
    await openToot()
    expect(container.textContent).toContain("Couldn't load this Song's notes.")
    await act(async () => play()?.click())
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(saved)
    const tryAgain = [...container.querySelectorAll('button')].find(
      b => b.textContent === 'Try again'
    )
    await act(async () => tryAgain?.click())
    expect(page.loadSong).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="toot-notes-failed"]')).toBeNull()
    expect(play()?.disabled).toBe(false)
  })
})
