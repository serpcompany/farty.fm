import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Toot } from '@/lib/toot'

// A saved Toot's Download (#408), from its row's More menu and its screen's: the account decides,
// then the Toot's own bytes go to the phone. `e2e/toot-download.spec.ts` drives a real download.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TITLE = 'Twinkle: take 2'
const FILE_NAME = 'Twinkle take 2.wav'
const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer

const aToot = (fields: Pick<Toot, 'isAudioMissing'> = {}): Toot => ({
  id: 'toot-1',
  title: TITLE,
  createdAt: 0,
  seconds: 1,
  songId: null,
  arrangement: null,
  performance: { recordings: [], taps: [] },
  ...fields
})

const page = vi.hoisted(() => ({
  toots: [] as Toot[],
  search: { id: 'toot-1' } as Record<string, string>,
  account: { status: 'signedIn', id: 'account-1' } as {
    status: string
    id?: string
    email?: string
  },
  afterStep: null as (() => void) | null,
  markAudioMissing: vi.fn(),
  openStep: vi.fn(),
  retry: vi.fn()
}))

const calls = vi.hoisted(() => ({
  hasFullAccess: vi.fn(),
  waitForFullAccess: vi.fn(),
  startDownloadCheckout: vi.fn(),
  loadTootAudio: vi.fn(),
  handOverFile: vi.fn(),
  reportError: vi.fn()
}))

vi.mock('./pedos-provider', () => ({
  tootPlayback: (id: string) => `toot:${id}`,
  usePedos: () => ({
    toots: page.toots,
    toot: (id: string) => page.toots.find(toot => toot.id === id),
    tootsFailed: false,
    nowPlaying: null,
    tootPlayFailed: null,
    markAudioMissing: page.markAudioMissing,
    toggleTootPlayback: () => {},
    deleteToot: () => {},
    renameToot: () => {},
    forgetToot: () => {},
    stopPlayback: () => {}
  })
}))
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: page.account, openStep: page.openStep, retry: page.retry })
}))
vi.mock('@/lib/sharing', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/sharing')>()),
  readShares: async () => ({ handle: 'alice', links: new Map(), tootLinks: new Map() })
}))
vi.mock('@/lib/full-access', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/full-access')>()),
  hasFullAccess: calls.hasFullAccess,
  waitForFullAccess: calls.waitForFullAccess,
  startDownloadCheckout: calls.startDownloadCheckout
}))
vi.mock('@/lib/toot-store', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/toot-store')>()),
  loadTootAudio: calls.loadTootAudio
}))
vi.mock('@/lib/toot-file', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/toot-file')>()),
  handOverFile: calls.handOverFile
}))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: calls.reportError }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(page.search),
  useRouter: () => ({ back: () => {}, push: () => {}, replace: () => {} })
}))
// The Toot's body isn't what's tested here.
vi.mock('./pad-take', () => ({ PadTootLayout: () => null }))
vi.mock('./song-creator', () => ({ TootLayout: () => null }))

const { TootAudioMissing } = await import('@/lib/toot-store')
const { TootsScreen } = await import('./toots-screen')
const { TootScreen } = await import('./toot-screen')

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  page.toots = [aToot()]
  page.search = { id: 'toot-1' }
  page.account = { status: 'signedIn', id: 'account-1' }
  page.afterStep = null
  page.openStep.mockImplementation((then?: () => void) => {
    page.afterStep = then ?? null
  })
  page.retry.mockImplementation(() => {
    page.account = { status: 'checking' }
  })
  calls.hasFullAccess.mockResolvedValue(true)
  calls.waitForFullAccess.mockResolvedValue('save')
  calls.loadTootAudio.mockResolvedValue(WAV)
  calls.handOverFile.mockResolvedValue('downloading')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

/** Lets what's waiting on a promise or a menu finish. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise(r => setTimeout(r, 0)))
}

const moreButton = () => {
  const more = document.querySelector<HTMLButtonElement>(`button[aria-label="More for ${TITLE}"]`)
  if (!more) throw new Error('No More button')
  return more
}

const menuItems = () =>
  [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim() ?? '')

const openMenu = async () => {
  await act(async () => moreButton().click())
  await settle()
}

const tapMenuItem = async (name: string) => {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    candidate => candidate.textContent?.trim() === name
  )
  if (!item) throw new Error(`No ${name} in the menu`)
  await act(async () => item.click())
  await settle()
}

const tapDownload = async () => {
  await openMenu()
  await tapMenuItem('Download')
}

const tapButton = async (name: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    candidate => candidate.textContent?.trim() === name
  )
  if (!button) throw new Error(`No ${name} button`)
  await act(async () => button.click())
  await settle()
}

const showToots = async () => {
  await act(async () => root?.render(<TootsScreen />))
  await settle()
}

const showToot = async () => {
  await act(async () => root?.render(<TootScreen />))
  await settle()
}

const handedFile = (): File => calls.handOverFile.mock.calls[0][0]
const note = () => document.querySelector('output')?.textContent
const sheet = () => document.querySelector('[data-testid="full-access-sheet"]')
const dialog = () => document.querySelector('[role="alertdialog"]')

describe('Download on a saved Toot', () => {
  it('sits in a row’s More menu, under Share', async () => {
    await showToots()
    await openMenu()
    expect(menuItems()).toEqual(['Share', 'Download', 'Rename', 'Delete'])
  })

  it('sits in the Toot screen’s More menu', async () => {
    await showToot()
    await openMenu()
    expect(menuItems()).toEqual(['Download', 'Rename', 'Delete'])
  })

  it('isn’t offered where the Toot’s audio is missing', async () => {
    page.toots = [aToot({ isAudioMissing: true })]
    await showToots()
    await openMenu()
    expect(menuItems()).toEqual(['Rename', 'Delete'])
  })

  it('asks nothing of the server until it’s tapped', async () => {
    await showToots()
    await openMenu()
    expect(calls.hasFullAccess).not.toHaveBeenCalled()
    expect(calls.loadTootAudio).not.toHaveBeenCalled()
  })
})

describe('Download with Full Access', () => {
  it('hands over the Toot’s own bytes, named after it, and says where it went', async () => {
    await showToots()
    await tapDownload()
    expect(calls.hasFullAccess).toHaveBeenCalledWith('account-1')
    expect(calls.loadTootAudio).toHaveBeenCalledWith('toot-1')
    const file = handedFile()
    expect(file.name).toBe(FILE_NAME)
    expect(file.type).toBe('audio/wav')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(WAV))
    expect(sheet()).toBeNull()
    expect(note()).toBe("Once it's downloaded, it's in your Downloads.")
  })

  it('says the Files app on an iPhone', async () => {
    const userAgent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
      )
    await showToots()
    await tapDownload()
    userAgent.mockRestore()
    expect(note()).toBe("Once it's downloaded, it's in the Files app.")
  })

  it('works the same from the Toot’s screen', async () => {
    await showToot()
    await tapDownload()
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('shows it’s working on the More button, and a second tap starts nothing', async () => {
    let answer: (active: boolean) => void = () => {}
    calls.hasFullAccess.mockReturnValue(new Promise(resolve => (answer = resolve)))
    await showToots()
    await tapDownload()
    expect(moreButton().disabled).toBe(true)
    expect(moreButton().getAttribute('aria-busy')).toBe('true')
    expect(moreButton().querySelector('[data-slot="spinner"], [role="status"]')).not.toBeNull()
    await act(async () => answer(true))
    await settle()
    expect(moreButton().disabled).toBe(false)
    expect(calls.handOverFile).toHaveBeenCalledOnce()
  })

  it('says nothing more once the share sheet took the file, or was closed', async () => {
    for (const handed of ['shared', 'cancelled']) {
      calls.handOverFile.mockResolvedValueOnce(handed)
      await showToots()
      await tapDownload()
      expect(note()).toBeUndefined()
      expect(dialog()).toBeNull()
    }
  })

  it('asks for a tap when the browser wants one, straight into the file', async () => {
    calls.handOverFile.mockResolvedValueOnce('needsTap')
    await showToots()
    await tapDownload()
    expect(dialog()?.textContent).toContain('Your Toot is ready to download')
    expect(dialog()?.textContent).toContain(FILE_NAME)
    await tapButton('Download')
    expect(calls.handOverFile).toHaveBeenCalledTimes(2)
    expect(calls.handOverFile.mock.calls[1]).toEqual([expect.any(File), true])
    expect(dialog()).toBeNull()
  })

  it('says so when the share sheet failed', async () => {
    calls.handOverFile.mockResolvedValueOnce('failed')
    await showToots()
    await tapDownload()
    expect(note()).toBe("Couldn't download this Toot. Try again.")
    expect(dialog()).toBeNull()
  })

  it('leaves the tap’s question when the page goes away', async () => {
    calls.handOverFile.mockResolvedValueOnce('needsTap')
    await showToots()
    await tapDownload()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await settle()
    vi.restoreAllMocks()
    expect(dialog()).toBeNull()
  })
})

describe('Download when it can’t give the file', () => {
  it('says so when Farty can’t say, and offers nothing to an account that may have paid', async () => {
    calls.hasFullAccess.mockResolvedValue(null)
    await showToots()
    await tapDownload()
    expect(note()).toBe("Couldn't reach Farty. Check your connection and try again.")
    expect(sheet()).toBeNull()
    expect(calls.loadTootAudio).not.toHaveBeenCalled()
  })

  it('marks a Toot whose audio turns out to be gone, as Play does', async () => {
    const gone = new TootAudioMissing('toot-1')
    calls.loadTootAudio.mockRejectedValue(gone)
    await showToots()
    await tapDownload()
    expect(page.markAudioMissing).toHaveBeenCalledWith('toot-1')
    expect(calls.reportError).toHaveBeenCalledWith('toot-audio-missing', gone)
    expect(note()).toBe("This Toot's audio is missing.")
    expect(calls.handOverFile).not.toHaveBeenCalled()
  })

  it('says to try again when the audio couldn’t be read this time', async () => {
    const failed = new Error('offline')
    calls.loadTootAudio.mockRejectedValue(failed)
    await showToots()
    await tapDownload()
    expect(page.markAudioMissing).not.toHaveBeenCalled()
    expect(calls.reportError).toHaveBeenCalledWith('toot-audio-read-failed', failed)
    expect(note()).toBe("Couldn't download this Toot. Check your connection and try again.")
  })

  it('lets a note go after a few seconds', async () => {
    calls.hasFullAccess.mockResolvedValue(null)
    await showToots()
    await tapDownload()
    expect(note()).toBeTruthy()
    await act(async () => await new Promise(r => setTimeout(r, 5_100)))
    expect(note()).toBeUndefined()
  }, 10_000)
})

describe('Download without an account', () => {
  it('opens the account step, then carries on once signed in', async () => {
    page.account = { status: 'signedOut' }
    await showToots()
    await tapDownload()
    expect(page.openStep).toHaveBeenCalledOnce()
    expect(calls.hasFullAccess).not.toHaveBeenCalled()

    page.account = { status: 'signedIn', id: 'account-1' }
    await act(async () => page.afterStep?.())
    await showToots()
    expect(calls.hasFullAccess).toHaveBeenCalledWith('account-1')
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('does nothing more if the account step closes signed out', async () => {
    page.account = { status: 'signedOut' }
    await showToots()
    await tapDownload()
    await act(async () => page.afterStep?.())
    await settle()
    expect(calls.hasFullAccess).not.toHaveBeenCalled()
    expect(note()).toBeUndefined()
  })

  it('reads an account it couldn’t read again, and carries on once it can', async () => {
    page.account = { status: 'unreachable' }
    await showToots()
    await tapDownload()
    expect(page.retry).toHaveBeenCalledOnce()
    expect(page.openStep).not.toHaveBeenCalled()
    expect(note()).toBeUndefined()
    expect(moreButton().disabled).toBe(true)

    page.account = { status: 'signedIn', id: 'account-1' }
    await showToots()
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('says so only if the account still can’t be read, and each tap reads it again', async () => {
    page.account = { status: 'unreachable' }
    await showToots()
    await tapDownload()
    page.account = { status: 'unreachable' }
    await showToots()
    expect(note()).toBe("Couldn't reach Farty. Check your connection and try again.")
    expect(moreButton().disabled).toBe(false)
    expect(calls.hasFullAccess).not.toHaveBeenCalled()

    await tapDownload()
    expect(page.retry).toHaveBeenCalledTimes(2)
    page.account = { status: 'signedIn', id: 'account-1' }
    await showToots()
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('waits for an account still being read, then goes by what it finds', async () => {
    page.account = { status: 'checking' }
    await showToots()
    await tapDownload()
    expect(page.retry).not.toHaveBeenCalled()
    expect(note()).toBeUndefined()
    expect(moreButton().disabled).toBe(true)

    page.account = { status: 'signedOut' }
    await showToots()
    expect(page.openStep).toHaveBeenCalledOnce()
    expect(calls.hasFullAccess).not.toHaveBeenCalled()
  })
})

describe('Download without Full Access', () => {
  beforeEach(() => {
    calls.hasFullAccess.mockResolvedValue(false)
  })

  it('offers the sheet, and gives no file', async () => {
    await showToots()
    await tapDownload()
    expect(sheet()?.textContent).toContain('Download any saved Toot as a file')
    expect(calls.loadTootAudio).not.toHaveBeenCalled()
    expect(calls.handOverFile).not.toHaveBeenCalled()
    await tapButton('Not now')
    await settle()
    expect(calls.startDownloadCheckout).not.toHaveBeenCalled()
  })

  it('doesn’t say “this Toot” of one that’s already saved', async () => {
    await showToots()
    await tapDownload()
    expect(sheet()?.querySelector('h2')?.textContent).toBe('Keep every Toot you make.')
    expect(sheet()?.textContent).not.toContain('Keep this Toot')
  })

  it('says whose email it’s under, as Save does', async () => {
    page.account = { status: 'signedIn', id: 'account-1', email: 'buyer@example.com' }
    await showToots()
    await tapDownload()
    expect(sheet()?.textContent).toContain('Buying for buyer@example.com.')
  })

  it('leaves the email line out when the account says no email', async () => {
    await showToots()
    await tapDownload()
    expect(sheet()?.textContent).not.toContain('Buying for')
  })

  it('goes to Checkout for this Toot on Pay', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, href: window.location.href, assign })
    calls.startDownloadCheckout.mockResolvedValue({
      kind: 'pay',
      url: 'https://checkout.stripe.com/c/pay/cs_test_a'
    })
    await showToots()
    await tapDownload()
    await tapButton('Pay $4.99')
    expect(calls.startDownloadCheckout).toHaveBeenCalledWith('toot-1', 'account-1')
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_a')
    vi.unstubAllGlobals()
  })

  it('hands over the file when Full Access arrived in the meantime', async () => {
    calls.startDownloadCheckout.mockResolvedValue({ kind: 'active' })
    await showToots()
    await tapDownload()
    calls.hasFullAccess.mockResolvedValue(true)
    await tapButton('Pay $4.99')
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('says why Pay didn’t start, and keeps what only support can sort out on screen', async () => {
    calls.startDownloadCheckout.mockResolvedValue({ kind: 'failed', problem: 'tooMany' })
    await showToots()
    await tapDownload()
    await tapButton('Pay $4.99')
    expect(note()).toBe("You've started a lot of payments. Try again later.")
    await tapDownload()

    calls.startDownloadCheckout.mockResolvedValue({ kind: 'failed', problem: 'charged' })
    await tapButton('Pay $4.99')
    expect(note()).toContain('Contact support')
    await act(async () => await new Promise(r => setTimeout(r, 5_100)))
    expect(note()).toContain('Contact support')
  }, 10_000)
})

describe('Back from Checkout for a Download', () => {
  beforeEach(() => {
    page.search = { id: 'toot-1', checkout: 'done' }
    window.history.replaceState(null, '', '/toots/toot/?id=toot-1&checkout=done')
  })

  it('hands over the file by itself once the payment comes through', async () => {
    await showToot()
    expect(calls.waitForFullAccess).toHaveBeenCalledWith('account-1')
    expect(handedFile().name).toBe(FILE_NAME)
    expect(dialog()).toBeNull()
    expect(note()).toBe("Once it's downloaded, it's in your Downloads.")
  })

  it('asks for the tap only where the browser wants one', async () => {
    calls.handOverFile.mockResolvedValueOnce('needsTap')
    await showToot()
    expect(dialog()?.textContent).toContain('Your Toot is ready to download')
    await tapButton('Download')
    expect(calls.handOverFile.mock.calls[1]).toEqual([expect.any(File), true])
  })

  it('counts at the Toot limit too, as it keeps no new Toot', async () => {
    calls.waitForFullAccess.mockResolvedValue('limitReached')
    await showToot()
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('takes the return off the address, so a reload doesn’t wait for a payment again', async () => {
    await showToot()
    expect(window.location.search).toBe('?id=toot-1')
  })

  it('says it’s confirming the payment while it waits, and starts once', async () => {
    let answer: (access: string | null) => void = () => {}
    calls.waitForFullAccess.mockReturnValue(new Promise(resolve => (answer = resolve)))
    await showToot()
    expect(moreButton().disabled).toBe(true)
    expect(note()).toBe('Confirming payment…')
    await showToot()
    expect(calls.waitForFullAccess).toHaveBeenCalledOnce()
    await act(async () => answer('save'))
    await settle()
    expect(moreButton().disabled).toBe(false)
    expect(note()).not.toBe('Confirming payment…')
  })

  it('keeps saying so when the payment hasn’t come through, and Download checks again', async () => {
    calls.waitForFullAccess.mockResolvedValue(null)
    await showToot()
    const notThrough = "Your payment hasn't come through yet. Tap Download to check again."
    expect(note()).toBe(notThrough)
    await act(async () => await new Promise(r => setTimeout(r, 5_100)))
    expect(note()).toBe(notThrough)
    expect(dialog()).toBeNull()
    // Only the file ends the return, so a reload would check again.
    expect(window.location.search).toContain('checkout=done')

    let answer: (access: string | null) => void = () => {}
    calls.waitForFullAccess.mockReturnValue(new Promise(resolve => (answer = resolve)))
    await tapDownload()
    expect(note()).toBe('Confirming payment…')
    await act(async () => answer('save'))
    await settle()
    expect(calls.waitForFullAccess).toHaveBeenCalledTimes(2)
    expect(handedFile().name).toBe(FILE_NAME)
    expect(window.location.search).toBe('?id=toot-1')
  }, 10_000)

  it('never offers to pay again here, however long the payment takes', async () => {
    calls.waitForFullAccess.mockResolvedValue(null)
    await showToot()
    await tapDownload()
    expect(calls.waitForFullAccess).toHaveBeenCalledTimes(2)
    expect(calls.hasFullAccess).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="full-access-sheet"]')).toBeNull()
    expect(note()).toBe("Your payment hasn't come through yet. Tap Download to check again.")
    expect(window.location.search).toContain('checkout=done')
  })

  it('says it’s confirming while the account is read, then waits for the payment', async () => {
    page.account = { status: 'checking' }
    await showToot()
    expect(calls.waitForFullAccess).not.toHaveBeenCalled()
    expect(window.location.search).toContain('checkout=done')
    expect(note()).toBe('Confirming payment…')
    expect(moreButton().disabled).toBe(true)
    page.account = { status: 'signedIn', id: 'account-1' }
    await showToot()
    expect(calls.waitForFullAccess).toHaveBeenCalledOnce()
    expect(handedFile().name).toBe(FILE_NAME)
  })

  it('keeps the return while the account can’t be read, and carries on when it can', async () => {
    page.account = { status: 'unreachable' }
    await showToot()
    expect(calls.waitForFullAccess).not.toHaveBeenCalled()
    expect(window.location.search).toContain('checkout=done')
    const unreachable = "Couldn't reach Farty. Check your connection and try again."
    expect(note()).toBe(unreachable)
    await act(async () => await new Promise(r => setTimeout(r, 5_100)))
    expect(note()).toBe(unreachable)

    page.account = { status: 'signedIn', id: 'account-1' }
    await showToot()
    expect(calls.waitForFullAccess).toHaveBeenCalledOnce()
    expect(handedFile().name).toBe(FILE_NAME)
    expect(window.location.search).toBe('?id=toot-1')
  }, 10_000)

  it('reads the account again on a tap, and still waits for the payment', async () => {
    page.account = { status: 'unreachable' }
    await showToot()
    await tapDownload()
    expect(page.retry).toHaveBeenCalledOnce()
    expect(note()).toBe('Confirming payment…')
    page.account = { status: 'signedIn', id: 'account-1' }
    await showToot()
    expect(calls.waitForFullAccess).toHaveBeenCalledOnce()
    expect(calls.hasFullAccess).not.toHaveBeenCalled()
    expect(calls.handOverFile).toHaveBeenCalledOnce()
  })

  it('opens the account step once when signed out, and carries on after it', async () => {
    page.account = { status: 'expired' }
    await showToot()
    await showToot()
    expect(page.openStep).toHaveBeenCalledOnce()
    expect(window.location.search).toContain('checkout=done')
    page.account = { status: 'signedIn', id: 'account-1' }
    await act(async () => page.afterStep?.())
    await showToot()
    expect(calls.waitForFullAccess).toHaveBeenCalledOnce()
    expect(calls.handOverFile).toHaveBeenCalledOnce()
  })

  it('says the payment went through where the Toot isn’t here', async () => {
    page.toots = []
    await showToot()
    expect(document.body.textContent).toContain("Couldn't find this Toot.")
    expect(document.body.textContent).toContain('Your payment went through')
    expect(calls.waitForFullAccess).not.toHaveBeenCalled()
  })

  it('never starts from a Toot’s row', async () => {
    await showToots()
    expect(calls.waitForFullAccess).not.toHaveBeenCalled()
    expect(calls.hasFullAccess).not.toHaveBeenCalled()
  })
})

describe('Back from a cancelled Checkout', () => {
  it('is just the Toot’s screen', async () => {
    page.search = { id: 'toot-1' }
    await showToot()
    expect(calls.waitForFullAccess).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    expect(note()).toBeUndefined()
  })

  it('says nothing of a payment where the Toot isn’t here', async () => {
    page.toots = []
    page.search = { id: 'toot-1' }
    await showToot()
    expect(document.body.textContent).toContain("Couldn't find this Toot.")
    expect(document.body.textContent).not.toContain('payment')
  })
})
