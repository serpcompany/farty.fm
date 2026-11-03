import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Song } from '@/lib/catalog/song'
import type { Toot } from '@/lib/toot'

// The Toots list names each Song Toot's Song from the Song Catalog, which loads as data (#322):
// while it loads, and if it fails, a row never shows an empty Song title, and a failed catalog
// says so, with Try again.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mary = { id: 'mary', title: 'Mary Had a Little Lamb' } as Song
const page = vi.hoisted(() => ({
  songs: null as readonly Song[] | null,
  songsFailed: false,
  reloadSongs: vi.fn()
}))

const toot: Toot = {
  id: 't1',
  title: 'My Mary',
  createdAt: Date.UTC(2026, 9, 1),
  seconds: 12,
  isAudioMissing: false,
  songId: 'mary',
  arrangement: { transposition: 0, recordingForPitch: {} }
} as Toot

vi.mock('./pedos-provider', () => ({
  tootPlayback: (id: string) => `${id}:all`,
  usePedos: () => ({
    toots: [toot],
    tootsFailed: false,
    songs: page.songs,
    songsFailed: page.songsFailed,
    reloadSongs: page.reloadSongs,
    song: (id: string) => page.songs?.find(song => song.id === id),
    nowPlaying: null,
    tootPlayFailed: null,
    forgetToot: () => {},
    toggleTootPlayback: () => {},
    deleteToot: () => {},
    renameToot: () => {}
  })
}))
// Each row's Shared tag (ADR 0020) reads the account: a guest's, which has no shares to read.
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedOut' }, openStep: () => {} })
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className
  }: {
    href: string
    children: unknown
    className?: string
  }) => (
    <a href={href} className={className}>
      {children as never}
    </a>
  )
}))

let root: Root | null = null

beforeEach(() => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  page.songs = null
  page.songsFailed = false
  vi.clearAllMocks()
})

async function show() {
  const { TootsScreen } = await import('./toots-screen')
  await act(async () => root?.render(<TootsScreen />))
}

const details = () => document.querySelector('[data-testid="toot-details"]')?.textContent ?? ''
const tryAgain = () =>
  [...document.querySelectorAll('button')].find(button => button.textContent === 'Try again')

it('names the Song once the catalog has loaded', async () => {
  page.songs = [mary]
  await show()
  expect(details()).toMatch(/^Mary Had a Little Lamb · /)
  expect(document.body.textContent).not.toContain("Couldn't load the Songs.")
})

it('says the Song is loading while the catalog loads', async () => {
  await show()
  expect(details()).toMatch(/^Loading… · /)
  expect(tryAgain()).toBeUndefined()
})

it('says the catalog failed, with Try again, and gives the row a neutral Song title', async () => {
  page.songsFailed = true
  await show()
  expect(document.body.textContent).toContain("Couldn't load the Songs.")
  expect(details()).toMatch(/^Song · /)
  await act(async () => tryAgain()?.click())
  expect(page.reloadSongs).toHaveBeenCalledOnce()
})
