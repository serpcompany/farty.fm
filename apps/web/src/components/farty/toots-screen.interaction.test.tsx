import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDecoded, play, stopPlayback } from '@/lib/audio/player'
import type { SongSummary } from '@/lib/catalog/song'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { waitingForRoom } from '@/lib/library-sync'
import { announceSent } from '@/lib/outbox'
import type { SongToot, Toot } from '@/lib/toot'
import * as tootStore from '@/lib/toot-store'
import {
  button,
  closeScreens,
  dialogs,
  hideAndShowPage,
  pageText,
  settle,
  show,
  tap,
  type
} from '@/test-support/screen'
import { PlaybackProvider } from './playback-provider'
import { SongCatalogProvider } from './song-catalog-provider'
import { TootScreen } from './toot-screen'
import { TootsProvider } from './toots-provider'
import { TootsScreen } from './toots-screen'

const catalog = vi.hoisted(() => ({
  loadSongs: vi.fn<() => Promise<readonly SongSummary[]>>()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ id: 't1' }),
  usePathname: () => '/toots/'
}))
vi.mock('@/lib/catalog/load-songs', () => ({
  loadSongs: catalog.loadSongs,
  loadSong: () => new Promise(() => undefined)
}))
vi.mock('react-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  preload: () => undefined
}))
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedOut' }, openStep: () => undefined })
}))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/toot-store', () => ({
  TootAudioMissing: class TootAudioMissing extends Error {},
  loadToots: vi.fn(),
  loadTootAudio: vi.fn(),
  renameToot: vi.fn(),
  deleteToot: vi.fn()
}))
vi.mock('@/lib/library-changes', () => ({ onLibraryChanged: () => () => undefined }))
vi.mock('@/lib/audio/player', () => import('@/test-support/fake-player'))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))
vi.mock('./recordings-provider', () => ({ useRecordings: () => ({ recording: () => undefined }) }))
vi.mock('@/lib/library-sync', () => ({ waitingForRoom: vi.fn() }))

const saved = (id: string, title: string, more: Partial<SongToot> = {}): SongToot => ({
  id,
  title,
  songId: songIndex[0].id,
  createdAt: 1,
  seconds: 9,
  arrangement: { transposition: 0, recordingForPitch: {} },
  ...more
})

const inToots = (screen: ReactNode) => (
  <PlaybackProvider>
    <SongCatalogProvider>
      <TootsProvider>{screen}</TootsProvider>
    </SongCatalogProvider>
  </PlaybackProvider>
)

function opened(toots: Toot[] | 'loading', screen: ReactNode) {
  vi.mocked(tootStore.loadToots).mockReturnValue(
    toots === 'loading' ? new Promise(() => undefined) : Promise.resolve(toots)
  )
  return show(inToots(screen))
}

function menuItem(name: string): HTMLElement {
  const found = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    item => item.textContent === name
  )
  if (!found) throw new Error(`No menu item ${name}`)
  return found
}

const buttonSaying = (words: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent === words)

async function fromMenu(title: string, item: 'Rename' | 'Delete') {
  await tap(button(`More for ${title}`))
  await tap(menuItem(item))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(play).mockResolvedValue(undefined)
  vi.mocked(waitingForRoom).mockResolvedValue(0)
  catalog.loadSongs.mockResolvedValue(songIndex)
})

afterEach(() => {
  closeScreens()
  vi.unstubAllGlobals()
})

describe('the Toots tab', () => {
  it('shows a spinner while the Toots load', async () => {
    await opened('loading', <TootsScreen />)
    expect(document.body.querySelector('[role="status"]')).not.toBeNull()
    expect(pageText()).not.toContain('Nothing yet')
  })

  it('keeps a Toot that plays playing into its screen, and lets go of the audio its rows decoded', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    const render = await opened([saved('t1', 'First'), saved('t2', 'Second')], <TootsScreen />)
    await tap(button('Play First'))
    expect(vi.mocked(play).mock.lastCall?.[0]).toBe('toot-t1')

    await render(inToots(<TootScreen />))
    expect(stopPlayback).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="song-creator-state"]')?.textContent).toBe(
      'Playing'
    )
    expect(vi.mocked(forgetDecoded).mock.calls).toEqual([['toot-t1'], ['toot-t2']])
  })

  it('says how many Toots wait for room while the account is full, until they upload', async () => {
    vi.mocked(waitingForRoom).mockResolvedValue(1)
    await opened([saved('t1', 'First')], <TootsScreen />)
    await settle()
    expect(pageText()).toContain(
      'Your account is full, so 1 Toot is only on this device. Delete some older ones to make room.'
    )
    expect(vi.mocked(waitingForRoom).mock.calls).toEqual([['toots']])

    vi.mocked(waitingForRoom).mockResolvedValue(0)
    await act(async () => announceSent())
    await settle()
    expect(pageText()).not.toContain('Your account is full')
  })

  it.each([
    ['Rename', () => fromMenu('First', 'Rename')],
    ['Delete', () => fromMenu('First', 'Delete')],
    ['audio-missing', () => tap(button('Gone: audio missing'))]
  ])('closes the %s dialog when the page is hidden', async (_, openDialog) => {
    await opened(
      [saved('t1', 'First'), saved('t2', 'Gone', { isAudioMissing: true })],
      <TootsScreen />
    )
    await openDialog()
    expect(dialogs()).toHaveLength(1)

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })
})

describe('a Toot’s screen', () => {
  it('renames the Toot from its More menu', async () => {
    await opened([saved('t1', 'First')], <TootScreen />)
    await fromMenu('First', 'Rename')
    const field = document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]')
    if (!field) throw new Error('No Name field')
    expect(field.value).toBe('First')

    await type(field, '  Mine ')
    await tap(button('Save'))
    expect(tootStore.renameToot).toHaveBeenCalledExactlyOnceWith('t1', 'Mine')
    expect(document.body.querySelector('h1')?.textContent).toBe('Mine')
  })

  it("says a Toot whose Song has left the Song Catalog isn't in Farty any more", async () => {
    await opened([saved('t1', 'First', { songId: 'a-song-farty-dropped' })], <TootScreen />)
    expect(pageText()).toContain("This Toot's Song isn't in Farty any more.")
  })

  it.each([
    'Rename',
    'Delete'
  ] as const)("closes the screen's %s dialog when the page is hidden", async item => {
    await opened([saved('t1', 'First')], <TootScreen />)
    await fromMenu('First', item)
    expect(dialogs()).toHaveLength(1)

    await hideAndShowPage()
    expect(dialogs()).toEqual([])
  })
})

describe('the Toots tab, naming each Song from the Song Catalog', () => {
  const mary = songIndex.find(song => song.id === 'mary') ?? songIndex[0]
  const ofMary = () => saved('t1', 'My Mary', { songId: mary.id })
  const details = () => document.body.querySelector('[data-testid="toot-details"]')?.textContent

  it('names the Song once the catalog has loaded', async () => {
    await opened([ofMary()], <TootsScreen />)
    expect(details()).toMatch(new RegExp(`^${mary.title} · `))
    expect(pageText()).not.toContain("Couldn't load the Songs.")
  })

  it('says the Song is loading while the catalog loads', async () => {
    catalog.loadSongs.mockReturnValue(new Promise(() => undefined))
    await opened([ofMary()], <TootsScreen />)
    expect(details()).toMatch(/^Loading… · /)
    expect(buttonSaying('Try again')).toBeUndefined()
  })

  it('says the catalog failed, with Try again, and gives the row a neutral Song title', async () => {
    catalog.loadSongs.mockRejectedValue(new TypeError('Failed to fetch'))
    await opened([ofMary()], <TootsScreen />)
    expect(pageText()).toContain("Couldn't load the Songs.")
    expect(details()).toMatch(/^Song · /)

    catalog.loadSongs.mockResolvedValue(songIndex)
    const tryAgain = buttonSaying('Try again')
    if (!tryAgain) throw new Error('No Try again')
    await tap(tryAgain)
    expect(catalog.loadSongs).toHaveBeenCalledTimes(2)
    expect(details()).toMatch(new RegExp(`^${mary.title} · `))
  })
})
