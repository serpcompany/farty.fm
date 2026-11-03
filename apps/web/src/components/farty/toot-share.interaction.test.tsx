import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Toot } from '@/lib/toot'
import { closeScreens, pageText, settle, show } from '@/test-support/screen'
import { TootScreen } from './toot-screen'
import { TootsScreen } from './toots-screen'

const SHARED = 'toot-shared'
const UNSHARED = 'toot-unshared'

const missing = (id: string, title: string): Toot => ({
  id,
  title,
  createdAt: 0,
  seconds: 1,
  songId: null,
  arrangement: null,
  performance: { recordings: [], taps: [] },
  isAudioMissing: true
})

const page = vi.hoisted(() => ({ toots: [] as Toot[], id: '' }))

vi.mock('./toots-provider', () => ({
  tootPlayback: (id: string) => `toot:${id}`,
  useToots: () => ({
    toots: page.toots,
    toot: (id: string) => page.toots.find(toot => toot.id === id),
    tootsFailed: false,
    tootPlayFailed: null,
    toggleTootPlayback: () => undefined,
    deleteToot: () => undefined,
    renameToot: () => undefined,
    forgetToot: () => undefined
  })
}))
vi.mock('./playback-provider', () => ({ usePlayback: () => ({ nowPlaying: null }) }))
vi.mock('./song-catalog-provider', () => ({
  useSongCatalog: () => ({
    songs: [],
    songsFailed: false,
    reloadSongs: () => undefined,
    song: () => undefined
  })
}))
vi.mock('./account-full-notice', () => ({ AccountFullNotice: () => null }))
vi.mock('@/lib/audio/player', () => ({ stopPlayback: () => undefined }))
vi.mock('./account-provider', () => ({
  useAccount: () => ({
    account: { status: 'signedIn', id: 'account-1' },
    openStep: () => undefined
  })
}))
vi.mock('@/lib/sharing', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/sharing')>()),
  readShares: async () => ({
    handle: 'alice',
    links: new Map(),
    tootLinks: new Map([[SHARED, 'https://farty.test/u/alice/t/abcdefghjkmn/']])
  })
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ id: page.id }),
  useRouter: () => ({ back: () => undefined, push: () => undefined, replace: () => undefined })
}))
vi.mock('./pad-toot-layout', () => ({ PadTootLayout: () => null }))
vi.mock('./toot-layout', () => ({ TootLayout: () => null }))

beforeEach(() => {
  page.toots = [missing(SHARED, 'Shared Toot'), missing(UNSHARED, 'Unshared Toot')]
})

afterEach(() => {
  closeScreens()
})

async function sharesRead() {
  for (let i = 0; i < 5; i++) await settle()
}

const byLabel = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

async function rowMenu(title: string): Promise<string[]> {
  const more = byLabel(`More for ${title}`)
  if (!more) throw new Error(`No More for ${title}`)
  await act(async () => more.click())
  await sharesRead()
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    item => item.textContent?.trim() ?? ''
  )
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  await sharesRead()
  return items
}

describe('A Toot whose audio is missing here', () => {
  it("keeps Share link and Stop sharing in its row's menu once shared, and no Share before", async () => {
    await show(<TootsScreen />)
    await sharesRead()
    expect(await rowMenu('Shared Toot')).toEqual(['Share link', 'Stop sharing', 'Rename', 'Delete'])
    expect(await rowMenu('Unshared Toot')).toEqual(['Rename', 'Delete'])
  })

  it('keeps Share in its header once shared, and none before', async () => {
    page.id = SHARED
    await show(<TootScreen />)
    await sharesRead()
    expect(pageText()).toContain('Shared')
    expect(byLabel('Share Shared Toot')).not.toBeNull()

    closeScreens()
    page.id = UNSHARED
    await show(<TootScreen />)
    await sharesRead()
    expect(byLabel('Share Unshared Toot')).toBeNull()
    expect(byLabel('More for Unshared Toot')).not.toBeNull()
  })
})
