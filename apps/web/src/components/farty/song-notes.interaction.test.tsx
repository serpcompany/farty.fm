import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/lib/catalog/song'
import { songIndex } from '@/lib/catalog/song-index.generated'
import type { SongToot } from '@/lib/toot'
import { closeScreens, pageText, show, tap } from '@/test-support/screen'
import { songs } from '@/test-support/songs.generated'
import { SongCreator } from './song-creator'
import { TootScreen } from './toot-screen'

const summary = songIndex[0]
const full = songs[0]

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
vi.mock('@/lib/audio/player', () => ({ stopPlayback: () => undefined }))
vi.mock('./song-catalog-provider', () => ({
  useSongCatalog: () => ({
    songs: songIndex,
    songsFailed: false,
    reloadSongs: vi.fn(),
    song: (id: string) => songIndex.find(s => s.id === id)
  })
}))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({ recordings: [], recording: () => undefined, makeToot: page.makeToot })
}))
vi.mock('./toots-provider', () => ({
  tootPlayback: () => '',
  useToots: () => ({
    toots: [saved],
    toot: (id: string) => (id === saved.id ? saved : undefined),
    tootsFailed: false,
    tootPlayFailed: null,
    toggleTootPlayback: page.toggleTootPlayback,
    forgetToot: () => undefined
  })
}))
vi.mock('./playback-provider', () => ({
  usePlayback: () => ({ nowPlaying: null, playbackStartedAt: null, togglePlayback: vi.fn() }),
  recordingSound: vi.fn()
}))
vi.mock('./favorite-button', () => ({ FavoriteButton: () => null }))
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

beforeEach(() => {
  page.makeToot.mockImplementation(() => new Promise<never>(() => undefined))
})

afterEach(() => {
  closeScreens()
  vi.clearAllMocks()
})

const tryAgain = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Try again')

it("makes the Toot from the Song's notes, once they've loaded", async () => {
  page.loadSong.mockResolvedValue(full)
  await show(<SongCreator id={summary.id} />)
  expect(page.loadSong).toHaveBeenCalledWith(summary)
  expect(page.makeToot).toHaveBeenCalledOnce()
  expect(page.makeToot.mock.calls[0][0]).toBe(full)
  expect(pageText()).toContain('Making your Toot')
})

it("says it couldn't load the Song, and tries again on Try again", async () => {
  page.loadSong.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  page.loadSong.mockResolvedValueOnce(full)
  await show(<SongCreator id={summary.id} />)
  expect(pageText()).toContain("Couldn't load this Song.")
  expect(page.reportError).toHaveBeenCalledWith('catalog-load-failed', expect.any(TypeError))
  expect(page.makeToot).not.toHaveBeenCalled()
  const again = tryAgain()
  if (!again) throw new Error('No Try again')
  await tap(again)
  expect(page.loadSong).toHaveBeenCalledTimes(2)
  expect(page.makeToot.mock.calls[0][0]).toBe(full)
  expect(pageText()).not.toContain("Couldn't load")
})

describe("a saved Toot's screen", () => {
  const play = () =>
    document.body.querySelector<HTMLButtonElement>('[data-testid="song-creator-play"]')

  it("plays the Toot while its Song's notes are still loading", async () => {
    page.loadSong.mockImplementation(() => new Promise<never>(() => undefined))
    await show(<TootScreen />)
    expect(pageText()).toContain(summary.source)
    expect(play()?.disabled).toBe(false)
    const playing = play()
    if (!playing) throw new Error('No Play')
    await tap(playing)
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(saved)
  })

  it("plays the Toot when its Song's notes fail to load, and offers Try again for them", async () => {
    page.loadSong.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    page.loadSong.mockResolvedValueOnce(full)
    await show(<TootScreen />)
    expect(pageText()).toContain("Couldn't load this Song's notes.")
    const playing = play()
    if (!playing) throw new Error('No Play')
    await tap(playing)
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(saved)
    const again = tryAgain()
    if (!again) throw new Error('No Try again')
    await tap(again)
    expect(page.loadSong).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[data-testid="toot-notes-failed"]')).toBeNull()
    expect(play()?.disabled).toBe(false)
  })
})
