import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Toot } from '@/lib/toot'

// Share on a saved Toot whose audio isn't on this device (ADR 0020, #317): a Toot shared from
// another device still offers Share link and Stop sharing, in its row's ⋯ menu and its header,
// since its link plays from the account. Only a new share needs the audio here.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

vi.mock('./pedos-provider', () => ({
  tootPlayback: (id: string) => `toot:${id}`,
  usePedos: () => ({
    toots: page.toots,
    toot: (id: string) => page.toots.find(toot => toot.id === id),
    tootsFailed: false,
    nowPlaying: null,
    tootPlayFailed: null,
    toggleTootPlayback: () => {},
    deleteToot: () => {},
    renameToot: () => {},
    forgetToot: () => {},
    stopPlayback: () => {}
  })
}))
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedIn', id: 'account-1' }, openStep: () => {} })
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
  useRouter: () => ({ back: () => {}, push: () => {}, replace: () => {} })
}))
// The Toot's body isn't what's tested here.
vi.mock('./pad-take', () => ({ PadTootLayout: () => null }))
vi.mock('./song-creator', () => ({ TootLayout: () => null }))

const { TootsScreen } = await import('./toots-screen')
const { TootScreen } = await import('./toot-screen')

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  page.toots = [missing(SHARED, 'Shared Toot'), missing(UNSHARED, 'Unshared Toot')]
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

/** Waits for the account's shares to be read, which happens after the first render. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise(r => setTimeout(r, 0)))
}

const byLabel = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

/** The items of the row menu labelled `More for <title>`, once opened. */
async function rowMenu(title: string): Promise<string[]> {
  const more = byLabel(`More for ${title}`)
  if (!more) throw new Error(`No More for ${title}`)
  await act(async () => more.click())
  await settle()
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    item => item.textContent?.trim() ?? ''
  )
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  await settle()
  return items
}

describe('A Toot whose audio is missing here', () => {
  it("keeps Share link and Stop sharing in its row's menu once shared, and no Share before", async () => {
    await act(async () => root?.render(<TootsScreen />))
    await settle()
    expect(await rowMenu('Shared Toot')).toEqual(['Share link', 'Stop sharing', 'Rename', 'Delete'])
    expect(await rowMenu('Unshared Toot')).toEqual(['Rename', 'Delete'])
  })

  it('keeps Share in its header once shared, and none before', async () => {
    page.id = SHARED
    await act(async () => root?.render(<TootScreen />))
    await settle()
    expect(container.textContent).toContain('Shared')
    expect(byLabel('Share Shared Toot')).not.toBeNull()

    act(() => root?.unmount())
    root = createRoot(container)
    page.id = UNSHARED
    await act(async () => root?.render(<TootScreen />))
    await settle()
    expect(byLabel('Share Unshared Toot')).toBeNull()
    expect(byLabel('More for Unshared Toot')).not.toBeNull()
  })
})
