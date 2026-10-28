import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDecoded, play, stopPlayback } from '@/lib/audio/player'
import { songs } from '@/lib/catalog/songs.generated'
import { waitingForRoom } from '@/lib/library-sync'
import { announceSent } from '@/lib/outbox'
import type { Toot } from '@/lib/toot'
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
import { TootScreen } from './toot-screen'
import { TootsProvider } from './toots-provider'
import { TootsScreen } from './toots-screen'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ id: 't1' })
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
vi.mock('@/lib/audio/player', () => ({
  play: vi.fn(),
  stopPlayback: vi.fn(),
  forgetDecoded: vi.fn()
}))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))
vi.mock('./recordings-provider', () => ({ useRecordings: () => ({ recording: () => undefined }) }))
vi.mock('@/lib/library-sync', () => ({ waitingForRoom: vi.fn() }))

const saved = (id: string, title: string, more: Partial<Toot> = {}): Toot => ({
  id,
  title,
  songId: songs[0].id,
  createdAt: 1,
  seconds: 9,
  arrangement: { transposition: 0, recordingForPitch: {} },
  ...more
})

const inToots = (screen: ReactNode) => (
  <PlaybackProvider>
    <TootsProvider>{screen}</TootsProvider>
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

async function fromMenu(title: string, item: 'Rename' | 'Delete') {
  await tap(button(`More for ${title}`))
  await tap(menuItem(item))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(play).mockResolvedValue(undefined)
  vi.mocked(waitingForRoom).mockResolvedValue(0)
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
      'Your account is full, so 1 Toot is only on this device. Delete some to make room.'
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
