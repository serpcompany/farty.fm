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

const saving = vi.hoisted(() => ({ paid: true }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/audio/player', () => ({ stopPlayback: vi.fn() }))
vi.mock('@/lib/stale-build', () => ({ holdReload: vi.fn() }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))
vi.mock('@/lib/toot-payment', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/toot-payment')>()
  return {
    ...real,
    saveAsksForPayment: () => saving.paid,
    readCheckoutReturn: vi.fn(),
    clearCheckoutReturn: vi.fn(),
    startCheckout: vi.fn(real.startCheckout),
    waitUntilPaid: vi.fn(async () => false)
  }
})
vi.mock('./toot-layout', () => ({ TootLayout: () => null }))
vi.mock('./account-provider', () => ({ useAccount: vi.fn() }))
vi.mock('./toots-provider', () => ({ useToots: vi.fn() }))
vi.mock('./recordings-provider', () => ({
  useRecordings: () => ({ recordings: [], makeToot: async () => draft })
}))

const PAID_TOOT = '44444444-4444-4444-8444-444444444444'
const song = songs.find(s => s.id === 'twinkle') ?? songs[0]
const draft: TootDraft = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  song,
  arrangement: { transposition: 0, recordingForPitch: {} },
  seconds: 9,
  wav: new ArrayBuffer(8)
}
const signedIn: Account = { status: 'signedIn', id: 'u1', email: 'a@b.c', marketingEmail: true }
const PAID_LABEL = 'Save to Toots · $0.99'

const saved = new Set<string>()
const saveToot = vi.fn(async (made: TootDraft) => {
  saved.add(made.id)
})
const toggleTootPlayback = vi.fn()
const releaseHold = vi.fn()
const session: { account: Account; stepOpen: boolean } = { account: signedIn, stepOpen: false }
const openStep = vi.fn(() => {
  session.stepOpen = true
})
const retry = vi.fn()

function asAccount(account: Account) {
  session.account = account
}

function openSongCreator(savingIs: 'free' | 'paid', account: Account = signedIn) {
  saving.paid = savingIs === 'paid'
  asAccount(account)
  return show(<SongCreator song={song} />)
}

function returnFromCheckout() {
  vi.mocked(readCheckoutReturn).mockReturnValue({ tootId: draft.id, done: true })
}

const buttonSaying = (words: string) =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes(words))

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(done => (resolve = done))
  return { promise, resolve }
}

function checkoutAnswers(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json(body, { status }))
}

function stubLocation() {
  const location = { ...window.location, assign: vi.fn(), replace: vi.fn() }
  vi.stubGlobal('location', location)
  return location
}

beforeEach(() => {
  vi.resetAllMocks()
  saved.clear()
  session.stepOpen = false
  vi.mocked(holdReload).mockReturnValue(releaseHold)
  vi.mocked(readCheckoutReturn).mockReturnValue(null)
  vi.mocked(useAccount).mockImplementation(
    () =>
      ({
        account: session.account,
        stepOpen: session.stepOpen,
        openStep,
        retry
      }) as unknown as ReturnType<typeof useAccount>
  )
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
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Song Creator', () => {
  it('stops what plays when it is left', async () => {
    await openSongCreator('free')
    expect(stopPlayback).not.toHaveBeenCalled()

    closeScreens()
    expect(stopPlayback).toHaveBeenCalledOnce()
  })

  it('saves at once where saving is free, with no checkout', async () => {
    await openSongCreator('free')
    expect(buttonSaying('Save')?.textContent).toBe('Save to Toots')

    await tap(button('Save to Toots'))
    expect(saveToot).toHaveBeenCalledExactlyOnceWith(draft)
    expect(startCheckout).not.toHaveBeenCalled()
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

  it.each([
    'paid',
    'free'
  ] as const)('keeps Save disabled while the account is still read, then lets it be tapped, where saving is %s', async savingIs => {
    const render = await openSongCreator(savingIs, { status: 'checking' })
    expect(buttonSaying('Save to Toots')?.disabled).toBe(true)

    asAccount(signedIn)
    await render(<SongCreator song={song} />)
    expect(buttonSaying('Save to Toots')?.disabled).toBe(false)
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
    await tap(button(PAID_LABEL))

    expect(pageText()).toContain(words)
    expect(button(PAID_LABEL).disabled).toBe(false)
  })

  it('says payments aren’t available when the server has none (payments_unavailable)', async () => {
    const fetch = checkoutAnswers({ error: 'payments_unavailable' }, 503)
    await openSongCreator('paid')
    expect(buttonSaying('Save to Toots')?.textContent).toBe(PAID_LABEL)
    await tap(button(PAID_LABEL))
    expect(fetch).toHaveBeenCalledOnce()
    expect(pageText()).toContain("Payments aren't available right now.")
    expect(button(PAID_LABEL).disabled).toBe(false)
  })

  it('says to try later past the checkout limit', async () => {
    checkoutAnswers({ error: 'rate_limited' }, 429)
    await openSongCreator('paid')
    await tap(button(PAID_LABEL))
    expect(pageText()).toContain("You've started a lot of payments. Try again later.")
  })

  it('says the user was charged and links Support when the paid session doesn’t match (payment_mismatch)', async () => {
    checkoutAnswers({ error: 'payment_mismatch' }, 409)
    await openSongCreator('paid')
    await tap(button(PAID_LABEL))
    expect(pageText()).toContain(
      "You were charged, but this Toot couldn't be saved. Contact support for a refund."
    )
    const link = [...document.body.querySelectorAll('a')].find(
      a => a.textContent === 'Contact support'
    )
    expect(link?.getAttribute('href')).toMatch(/^\/support\/?$/)
  })

  it('says Confirming payment… while the return is checked, then that the payment hasn’t come through', async () => {
    const paid = deferred<boolean>()
    vi.mocked(waitUntilPaid).mockReturnValue(paid.promise)
    returnFromCheckout()
    await openSongCreator('paid')
    expect(buttonSaying('Confirming payment…')?.disabled).toBe(true)

    await act(async () => paid.resolve(false))
    expect(pageText()).toContain("Your payment hasn't come through yet. Tap Save to check again.")
    expect(button(PAID_LABEL).disabled).toBe(false)
  })

  it('says the payment hasn’t come through yet, back from Checkout, and checks again on Save', async () => {
    returnFromCheckout()
    await openSongCreator('paid')
    expect(waitUntilPaid).toHaveBeenCalledWith(draft.id, 'u1')
    expect(pageText()).toContain("Your payment hasn't come through yet. Tap Save to check again.")
    expect(saveToot).not.toHaveBeenCalled()

    checkoutAnswers({ paid: true })
    await tap(button(PAID_LABEL))
    expect(saveToot).toHaveBeenCalledWith(draft)
  })

  it('keeps Save waiting, disabled, while the account is still read on the return', async () => {
    vi.mocked(waitUntilPaid).mockResolvedValue(true)
    returnFromCheckout()
    const render = await openSongCreator('paid', { status: 'checking' })
    expect(buttonSaying('Confirming payment…')?.disabled).toBe(true)
    expect(waitUntilPaid).not.toHaveBeenCalled()

    asAccount(signedIn)
    await render(<SongCreator song={song} />)
    expect(waitUntilPaid).toHaveBeenCalledWith(draft.id, 'u1')
    expect(button('Saved to Toots').disabled).toBe(true)
  })

  it('saves a paid Toot of the Song never saved, instead of paying again', async () => {
    checkoutAnswers({ paidToot: PAID_TOOT })
    const location = stubLocation()
    await openSongCreator('paid')
    await tap(button(PAID_LABEL))
    expect(location.replace).toHaveBeenCalledWith(
      `/compose/${song.id}/?toot=${PAID_TOOT}&checkout=done`
    )
    expect(location.assign).not.toHaveBeenCalled()
    expect(button(PAID_LABEL).disabled).toBe(true)
  })

  it('offers a retry when the account can’t be read after a paid return', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    returnFromCheckout()
    const render = await openSongCreator('paid', { status: 'unreachable' })
    expect(pageText()).toContain("Couldn't reach your account. Tap Save to try again.")
    expect(button(PAID_LABEL).disabled).toBe(false)
    await tap(button(PAID_LABEL))
    expect(retry).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()

    asAccount(signedIn)
    await render(<SongCreator song={song} />)
    expect(waitUntilPaid).toHaveBeenCalledWith(draft.id, 'u1')
  })

  it('reads the account again when Save is tapped while it can’t be read', async () => {
    const render = await openSongCreator('paid', { status: 'unreachable' })
    expect(pageText()).not.toContain("Couldn't reach your account.")
    await tap(button(PAID_LABEL))
    expect(retry).toHaveBeenCalledOnce()
    expect(pageText()).toContain("Couldn't reach your account. Tap Save to try again.")

    asAccount(signedIn)
    await render(<SongCreator song={song} />)
    expect(pageText()).not.toContain("Couldn't reach your account.")
  })

  it('makes Save tappable again when the browser comes back from the checkout page', async () => {
    const location = stubLocation()
    vi.mocked(startCheckout).mockResolvedValue({
      kind: 'pay',
      url: 'https://checkout.stripe.com/c'
    })
    await openSongCreator('paid')
    await tap(button(PAID_LABEL))
    expect(location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c')
    expect(button(PAID_LABEL).disabled).toBe(true)

    const shown = (persisted: boolean) =>
      act(async () => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted })))
    await shown(false)
    expect(button(PAID_LABEL).disabled).toBe(true)
    await shown(true)
    expect(button(PAID_LABEL).disabled).toBe(false)
  })
})

describe('Save to Toots, as a guest', () => {
  it.each([
    ['paid', PAID_LABEL],
    ['free', 'Save to Toots']
  ] as const)('asks for an account before saving or paying, where saving is %s', async (savingIs, label) => {
    const fetch = checkoutAnswers({ paid: true })
    const render = await openSongCreator(savingIs, { status: 'signedOut' })
    expect(buttonSaying('Save to Toots')?.textContent).toBe(label)
    await tap(button(label))
    expect(openStep).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(saveToot).not.toHaveBeenCalled()

    asAccount(signedIn)
    session.stepOpen = false
    await render(<SongCreator song={song} />)
    if (savingIs === 'paid') {
      expect(fetch).toHaveBeenCalledWith(`/api/toots/${draft.id}/checkout/`, expect.anything())
    } else expect(fetch).not.toHaveBeenCalled()
    expect(saveToot).toHaveBeenCalledWith(draft)
  })

  it('saves nothing when the step closes with Not now', async () => {
    const render = await openSongCreator('free', { status: 'signedOut' })
    await tap(button('Save to Toots'))
    session.stepOpen = false
    await render(<SongCreator song={song} />)
    asAccount(signedIn)
    await render(<SongCreator song={song} />)
    expect(saveToot).not.toHaveBeenCalled()
  })
})

describe('Save to Toots, where saving is free, while the account can’t be read', () => {
  it('saves in a browser whose library is an account’s, as offline before #237', async () => {
    localStorage.setItem('pedos.account', 'userA')
    await openSongCreator('free', { status: 'unreachable' })
    await tap(button('Save to Toots'))
    expect(saveToot).toHaveBeenCalledWith(draft)
    expect(retry).not.toHaveBeenCalled()
  })

  it('reads the account again in a guest’s browser, and saves nothing', async () => {
    await openSongCreator('free', { status: 'unreachable' })
    await tap(button('Save to Toots'))
    expect(saveToot).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledOnce()
    expect(pageText()).toContain("Couldn't reach your account. Tap Save to try again.")
  })
})
