import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Toot } from '@/lib/toot'

// Download on a saved Toot (#408): in its row's ⋯ menu and its screen's, for an account with Full
// Access. The server decides at the tap: a refund since the last read takes the item away.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toot = (id: string, title: string, isAudioMissing: boolean): Toot => ({
  id,
  title,
  createdAt: 0,
  seconds: 1,
  songId: null,
  arrangement: null,
  performance: { recordings: [], taps: [] },
  isAudioMissing
})

const page = vi.hoisted(() => ({
  toots: [] as Toot[],
  id: '',
  account: { status: 'signedIn', id: '' } as { status: string; id?: string }
}))
const hasStoredFullAccess = vi.hoisted(() => vi.fn<() => Promise<boolean | null>>())
const fetchTootFile = vi.hoisted(() => vi.fn())
const offerTootFile = vi.hoisted(() => vi.fn())

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
  useAccount: () => ({ account: page.account, openStep: () => {} })
}))
vi.mock('@/lib/full-access', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/full-access')>()),
  hasStoredFullAccess
}))
vi.mock('@/lib/toot-download', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/toot-download')>()),
  fetchTootFile,
  offerTootFile
}))
vi.mock('@/lib/sharing', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/sharing')>()),
  readShares: async () => ({ handle: 'alice', links: new Map(), tootLinks: new Map() })
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

const FILE = new File(['RIFF'], 'Here.wav', { type: 'audio/wav' })

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  page.toots = [toot('toot-here', 'Here', false), toot('toot-missing', 'Missing', true)]
  // A new account each test, since what's read is kept across a list's rows.
  page.account = { status: 'signedIn', id: crypto.randomUUID() }
  hasStoredFullAccess.mockReset().mockResolvedValue(true)
  fetchTootFile.mockReset().mockResolvedValue({ file: FILE })
  offerTootFile.mockReset().mockResolvedValue('offered')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise(r => setTimeout(r, 0)))
}

async function openMenu(title: string) {
  const more = document.querySelector<HTMLButtonElement>(`button[aria-label="More for ${title}"]`)
  if (!more) throw new Error(`No More for ${title}`)
  await act(async () => more.click())
  await settle()
}

const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(item => ({
    name: item.textContent?.trim() ?? '',
    item
  }))

async function closeMenu() {
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  await settle()
}

async function menu(title: string): Promise<string[]> {
  await openMenu(title)
  const names = menuItems().map(({ name }) => name)
  await closeMenu()
  return names
}

async function tapDownload(title: string) {
  await openMenu(title)
  const download = menuItems().find(({ name }) => name === 'Download')
  if (!download) throw new Error('No Download')
  await act(async () => download.item.click())
  await settle()
}

const renderList = async () => {
  await act(async () => root?.render(<TootsScreen />))
  await settle()
}

const note = () => document.querySelector('output')?.textContent ?? null

describe('Download on a saved Toot', () => {
  it('shows in the menu of a Toot with its audio, with Full Access', async () => {
    await renderList()
    expect(await menu('Here')).toContain('Download')
    expect(await menu('Missing')).not.toContain('Download')
  })

  it('shows in the Toot screen’s menu too', async () => {
    page.id = 'toot-here'
    await act(async () => root?.render(<TootScreen />))
    await settle()
    expect(await menu('Here')).toContain('Download')
  })

  it('says why from the Toot screen too, when there’s no file', async () => {
    fetchTootFile.mockResolvedValue({ error: 'noFullAccess' })
    page.id = 'toot-here'
    await act(async () => root?.render(<TootScreen />))
    await settle()
    await tapDownload('Here')
    expect(note()).toBe('Download needs Full Access.')
  })

  it('offers a held-back file from the Toot screen too', async () => {
    offerTootFile.mockResolvedValueOnce('needsTap')
    page.id = 'toot-here'
    await act(async () => root?.render(<TootScreen />))
    await settle()
    await tapDownload('Here')
    expect(document.body.textContent).toContain('Your file is ready')
  })

  it('stays hidden without Full Access, or while Farty can’t say', async () => {
    hasStoredFullAccess.mockResolvedValue(false)
    await renderList()
    expect(await menu('Here')).not.toContain('Download')

    act(() => root?.unmount())
    root = createRoot(container)
    page.account = { status: 'signedIn', id: crypto.randomUUID() }
    hasStoredFullAccess.mockResolvedValue(null)
    await renderList()
    expect(await menu('Here')).not.toContain('Download')
  })

  it('stays hidden for a guest, with nothing asked', async () => {
    page.account = { status: 'signedOut' }
    await renderList()
    expect(await menu('Here')).not.toContain('Download')
    expect(hasStoredFullAccess).not.toHaveBeenCalled()
  })

  it('asks once for a whole list', async () => {
    await renderList()
    expect(hasStoredFullAccess).toHaveBeenCalledTimes(1)
  })

  it('fetches the file as the account and hands it to the phone', async () => {
    await renderList()
    await tapDownload('Here')
    expect(fetchTootFile).toHaveBeenCalledWith('toot-here', 'Here', page.account.id)
    expect(offerTootFile).toHaveBeenCalledWith(FILE)
    expect(note()).toBeNull()
  })

  it('says it’s downloading while the file is on its way', async () => {
    let arrive: (file: unknown) => void = () => {}
    fetchTootFile.mockReturnValue(new Promise(resolve => (arrive = resolve)))
    await renderList()
    await tapDownload('Here')
    expect(note()).toBe('Downloading…')
    await act(async () => arrive({ file: FILE }))
    await settle()
    expect(note()).toBeNull()
    expect(offerTootFile).toHaveBeenCalledTimes(1)
  })

  it('takes the item away when the server says Full Access has ended', async () => {
    fetchTootFile.mockResolvedValue({ error: 'noFullAccess' })
    await renderList()
    await tapDownload('Here')
    expect(note()).toBe('Download needs Full Access.')
    expect(offerTootFile).not.toHaveBeenCalled()
    expect(await menu('Here')).toEqual(['Share', 'Rename', 'Delete'])
  })

  it('keeps the item when the file just isn’t there yet, or the network fails', async () => {
    await renderList()
    fetchTootFile.mockResolvedValue({ error: 'notUploaded' })
    await tapDownload('Here')
    expect(note()).toBe("This Toot hasn't reached your account yet. Try again in a moment.")
    fetchTootFile.mockResolvedValue({ error: 'failed' })
    await tapDownload('Here')
    expect(note()).toBe("Couldn't download. Check your connection and try again.")
    expect(await menu('Here')).toContain('Download')
  })

  it('drops an earlier note when the next try works', async () => {
    await renderList()
    fetchTootFile.mockResolvedValueOnce({ error: 'failed' })
    await tapDownload('Here')
    expect(note()).toBe("Couldn't download. Check your connection and try again.")
    await tapDownload('Here')
    expect(offerTootFile).toHaveBeenCalledTimes(1)
    expect(note() ?? '').toBe('')
  })

  it('offers the file again from a fresh tap when the browser held it back', async () => {
    offerTootFile.mockResolvedValueOnce('needsTap')
    await renderList()
    await tapDownload('Here')
    expect(document.body.textContent).toContain('Your file is ready')
    expect(document.body.textContent).toContain('Here.wav')
    const save = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save file')
    await act(async () => save?.click())
    await settle()
    expect(offerTootFile).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain('Your file is ready')
  })
})
