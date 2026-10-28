import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/lib/account'
import { stopPlayback } from '@/lib/audio/player'
import { songs } from '@/lib/catalog/songs.generated'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import type { TootDraft } from '@/lib/toot'
import { readCheckoutReturn, startCheckout, waitUntilPaid } from '@/lib/toot-payment'
import { button, closeScreens, pageText, show, tap } from '@/test-support/screen'
import { useAccount } from './account-provider'
import { SongCreator } from './song-creator'
import { useToots } from './toots-provider'

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/audio/player', () => ({ stopPlayback: vi.fn() }))
vi.mock('@/lib/stale-build', () => ({ holdReload: vi.fn() }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))
vi.mock('@/lib/toot-payment', async importOriginal => ({
  saveAsksForPayment: (await importOriginal<typeof import('@/lib/toot-payment')>())
    .saveAsksForPayment,
  readCheckoutReturn: vi.fn(),
  clearCheckoutReturn: vi.fn(),
  startCheckout: vi.fn(),
  waitUntilPaid: vi.fn()
}))
vi.mock('./toot-layout', () => ({ TootLayout: () => null }))
vi.mock('./account-provider', () => ({ useAccount: vi.fn() }))
vi.mock('./toots-provider', () => ({ useToots: vi.fn() }))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({ recordings: [], makeToot: async () => draft })
}))

const song = songs[0]
const draft: TootDraft = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  song,
  arrangement: { transposition: 0, recordingForPitch: {} },
  seconds: 9,
  wav: new ArrayBuffer(8)
}
const signedIn: Account = { status: 'signedIn', id: 'u1', email: 'a@b.c', marketingEmail: true }

const saved = new Set<string>()
const saveToot = vi.fn(async (made: TootDraft) => {
  saved.add(made.id)
})
const toggleTootPlayback = vi.fn()
const offerStep = vi.fn()
const releaseHold = vi.fn()

function asAccount(account: Account) {
  vi.mocked(useAccount).mockReturnValue({
    account,
    stepOpen: false,
    offerStep,
    openStep: vi.fn()
  } as unknown as ReturnType<typeof useAccount>)
}

function openSongCreator(savingIs: 'free' | 'paid', account: Account = signedIn) {
  vi.stubEnv('FARTY_ENVIRONMENT', savingIs === 'free' ? 'production' : 'staging')
  asAccount(account)
  return show(<SongCreator song={song} />)
}

const buttonSaying = (words: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes(words))

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(done => (resolve = done))
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  saved.clear()
  vi.mocked(holdReload).mockReturnValue(releaseHold)
  vi.mocked(readCheckoutReturn).mockReturnValue(null)
  vi.mocked(useToots).mockImplementation(
    () =>
      ({
        toot: (id: string) => (saved.has(id) ? { id } : undefined),
        saveToot,
        toggleTootPlayback,
        forgetToot: vi.fn()
      }) as unknown as ReturnType<typeof useToots>
  )
})

afterEach(() => {
  closeScreens()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Song Creator', () => {
  it('stops what plays when it is left', async () => {
    await openSongCreator('free')
    expect(stopPlayback).not.toHaveBeenCalled()

    closeScreens()
    expect(stopPlayback).toHaveBeenCalledOnce()
  })

  it('saves at once where saving is free, with no checkout, and offers the account step', async () => {
    await openSongCreator('free', { status: 'signedOut' })
    expect(buttonSaying('Save')?.textContent).toBe('Save to Toots')

    await tap(button('Save to Toots'))
    expect(saveToot).toHaveBeenCalledExactlyOnceWith(draft)
    expect(startCheckout).not.toHaveBeenCalled()
    expect(offerStep).toHaveBeenCalledExactlyOnceWith('toot')
    expect(button('Saved to Toots').disabled).toBe(true)
  })

  it("says a save that failed couldn't save, and reports it", async () => {
    const failure = new TypeError('quota')
    saveToot.mockRejectedValueOnce(failure)
    await openSongCreator('free')
    await tap(button('Save to Toots'))

    expect(pageText()).toContain("Couldn't save this Toot.")
    expect(reportError).toHaveBeenCalledWith('toot-save-failed', failure)
    expect(button('Save to Toots').disabled).toBe(false)
  })

  it('holds off a new build until the Toot is saved', async () => {
    await openSongCreator('free')
    expect(holdReload).toHaveBeenCalledOnce()
    expect(releaseHold).not.toHaveBeenCalled()

    await tap(button('Save to Toots'))
    expect(releaseHold).toHaveBeenCalledOnce()
    expect(holdReload).toHaveBeenCalledOnce()
  })

  it('plays the Toot once made, but waits for a tap on the return from the checkout', async () => {
    await openSongCreator('paid')
    expect(toggleTootPlayback).toHaveBeenCalledExactlyOnceWith(draft)
    closeScreens()
    toggleTootPlayback.mockClear()

    vi.mocked(readCheckoutReturn).mockReturnValue({ tootId: draft.id, done: false })
    await openSongCreator('paid')
    expect(pageText()).toContain(song.title)
    expect(toggleTootPlayback).not.toHaveBeenCalled()
  })
})

describe('Song Creator where saving is paid', () => {
  it.each([
    ['unavailable', "Payments aren't available right now."],
    ['limitReached', "You've kept as many Toots as an account can. Delete one to save this one."],
    ['failed', "Couldn't start the payment."]
  ] as const)("says why a checkout couldn't start (%s)", async (problem, words) => {
    vi.mocked(startCheckout).mockResolvedValue({ kind: 'failed', problem })
    await openSongCreator('paid')
    await tap(button('Save to Toots · $0.99'))

    expect(pageText()).toContain(words)
    expect(button('Save to Toots · $0.99').disabled).toBe(false)
  })

  it('says Confirming payment… while the return is checked, then that the payment hasn’t come through', async () => {
    const paid = deferred<boolean>()
    vi.mocked(waitUntilPaid).mockReturnValue(paid.promise)
    vi.mocked(readCheckoutReturn).mockReturnValue({ tootId: draft.id, done: true })
    await openSongCreator('paid')
    expect(buttonSaying('Confirming payment…')?.disabled).toBe(true)

    await act(async () => paid.resolve(false))
    expect(pageText()).toContain("Your payment hasn't come through yet. Tap Save to check again.")
    expect(button('Save to Toots · $0.99').disabled).toBe(false)
  })

  it('keeps Save waiting, disabled, while the account is still read on the return', async () => {
    vi.mocked(waitUntilPaid).mockResolvedValue(true)
    vi.mocked(readCheckoutReturn).mockReturnValue({ tootId: draft.id, done: true })
    const render = await openSongCreator('paid', { status: 'checking' })
    expect(buttonSaying('Confirming payment…')?.disabled).toBe(true)
    expect(waitUntilPaid).not.toHaveBeenCalled()

    asAccount(signedIn)
    await render(<SongCreator song={song} />)
    expect(waitUntilPaid).toHaveBeenCalledWith(draft.id, 'u1')
    expect(button('Saved to Toots').disabled).toBe(true)
  })

  it('makes Save tappable again when the browser comes back from the checkout page', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    vi.mocked(startCheckout).mockResolvedValue({
      kind: 'pay',
      url: 'https://checkout.stripe.com/c'
    })
    await openSongCreator('paid')
    await tap(button('Save to Toots · $0.99'))
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c')
    expect(button('Save to Toots · $0.99').disabled).toBe(true)

    const shown = (persisted: boolean) =>
      act(async () => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted })))
    await shown(false)
    expect(button('Save to Toots · $0.99').disabled).toBe(true)
    await shown(true)
    expect(button('Save to Toots · $0.99').disabled).toBe(false)
  })
})
