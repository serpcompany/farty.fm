import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/lib/account'
import { songs } from '@/lib/catalog/songs.generated'
import type { CheckoutReturn } from '@/lib/full-access'
import { clearPaymentPending, notePaymentPending } from '@/lib/full-access-offers'
import type { SongTootDraft } from '@/lib/toot'

// Song Creator's Save where saving is paid (ADR 0022), in a DOM: an account with Full Access saves,
// one without is offered it on a sheet, and Pay goes to Checkout; what Save says when payments are
// off or limited, when the payment hasn't come through, and when the account can't be read after a
// paid return; and that a guest's Save asks for an account first, paid or free, while a free one
// saves offline in an account's browser (#237). The server is `fetch`, answering as the routes do.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TOOT = '33333333-3333-4333-8333-333333333333'

const page = vi.hoisted(() => ({
  account: {
    status: 'signedIn',
    id: 'userA',
    email: 'a@example.test',
    marketingEmail: false,
    showFartPlaces: true
  } as Account,
  stepOpen: false,
  retry: vi.fn(),
  openStep: vi.fn(),
  saveToot: vi.fn(),
  saved: false,
  paid: true
}))

vi.mock('./account-provider', () => ({
  useAccount: () => ({
    account: page.account,
    stepOpen: page.stepOpen,
    openStep: page.openStep,
    retry: page.retry
  })
}))
vi.mock('./pedos-provider', () => ({
  tootPlayback: (id: string, note?: number) => `${id}:${note ?? 'all'}`,
  usePedos: () => ({
    toot: () => (page.saved ? {} : undefined),
    saveToot: page.saveToot,
    recording: () => undefined,
    nowPlaying: null,
    tootPlayFailed: null,
    playbackStartedAt: null
  })
}))
vi.mock('./note-view', () => ({ NoteView: () => null, pitchColor: () => 'currentColor' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }))
vi.mock('@/lib/recording-store', () => ({}))
vi.mock('@/lib/toot-renderer', () => ({ TootError: class extends Error {} }))
vi.mock('@/lib/stale-build', () => ({ holdReload: () => undefined }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))
vi.mock('@/lib/full-access', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/full-access')>()),
  // Saving is paid in this build unless a test says so, and the wait for a payment is cut short.
  saveAsksForPayment: () => page.paid,
  waitForFullAccess: vi.fn(async () => null),
  clearCheckoutReturn: vi.fn()
}))

const song = songs.find(s => s.id === 'twinkle')
if (!song) throw new Error('twinkle is in the catalog')
const draft: SongTootDraft = {
  id: TOOT,
  song,
  arrangement: { transposition: 0, recordingForPitch: {} },
  seconds: 1,
  wav: new ArrayBuffer(0)
}

let root: Root | null = null
let container: HTMLDivElement

async function render(back: CheckoutReturn | null = null) {
  const { SaveToToots, TootLayout } = await import('./song-creator')
  await act(async () =>
    root?.render(
      <>
        <TootLayout toot={draft} song={draft.song} />
        <SaveToToots draft={draft} back={back} />
      </>
    )
  )
}

const CHECKOUT_PATH = '/api/full-access/checkout/'
const ACCESS_PATH = '/api/full-access/'
const STRIPE_PAGE = 'https://checkout.stripe.com/c/pay/cs_test_a'

/** The server answers as its routes do: no Full Access and a Checkout page, unless a test says. */
function server({
  access = { active: false },
  accessStatus = 200,
  checkout = { url: STRIPE_PAGE },
  checkoutStatus = 200
}: {
  access?: unknown
  accessStatus?: number
  checkout?: unknown
  checkoutStatus?: number
} = {}) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async input =>
      String(input) === CHECKOUT_PATH
        ? Response.json(checkout, { status: checkoutStatus })
        : Response.json(access, { status: accessStatus })
    )
}

const saveButton = () => {
  const button = [...container.querySelectorAll('button')].find(b =>
    b.textContent?.includes('Save to Toots')
  )
  if (!button) throw new Error('no Save button')
  return button
}

async function tapSave() {
  await act(async () => saveButton().click())
}

// The sheet opens over the page, outside `container`.
const sheet = () => document.querySelector<HTMLElement>('[data-testid="full-access-sheet"]')

async function tapOnSheet(label: string) {
  const button = [...(sheet()?.querySelectorAll('button') ?? [])].find(
    b => b.textContent?.trim() === label
  )
  if (!button) throw new Error(`no ${label} on the sheet`)
  await act(async () => button.click())
}

/** Save, which offers Full Access, then Pay on its sheet. */
async function payOnTheSheet() {
  await tapSave()
  expect(sheet()).not.toBeNull()
  await tapOnSheet('Pay $4.99')
}

function asked(fetch: ReturnType<typeof server>, path: string) {
  return fetch.mock.calls.filter(([input]) => String(input) === path).length
}

beforeEach(() => {
  page.account = {
    status: 'signedIn',
    id: 'userA',
    email: 'a@example.test',
    marketingEmail: false,
    showFartPlaces: true
  }
  page.saved = false
  page.stepOpen = false
  page.paid = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('Save to Toots, where saving is paid', () => {
  it('saves on an account with Full Access, offering nothing and starting no Checkout', async () => {
    const fetch = server({ access: { active: true } })
    await render()
    expect(saveButton().textContent).toBe('Save to Toots')
    await tapSave()
    expect(sheet()).toBeNull()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(page.saveToot).toHaveBeenCalledWith(draft)
  })

  it('offers Full Access on a sheet to an account without it, in the order the offer reads', async () => {
    const fetch = server()
    await render()
    await tapSave()
    const text = sheet()?.textContent ?? ''
    const lines = [
      'Keep this Toot, and every one after it.',
      'Save up to 300 Toots, from Songs and the Sound Pad',
      'Send any saved Toot by link. Anyone can play it, no account needed',
      'Download any saved Toot as a file',
      "They're in your account, on any phone or tablet you sign in on",
      'Full Access',
      'Once, no subscription',
      '$4.99',
      'Pay $4.99',
      '14 days to get your money back.',
      'Not now',
      'Buying for a@example.test. Checkout uses this email, and refunds are looked up by it.'
    ]
    const places = lines.map(line => text.indexOf(line))
    expect(places).not.toContain(-1)
    expect(places).toEqual([...places].sort((a, b) => a - b))
    expect(sheet()?.querySelector('a')?.getAttribute('href')).toMatch(/^\/support\/?$/)
    expect(sheet()?.querySelector('a')?.textContent).toBe('14 days to get your money back')
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(page.saveToot).not.toHaveBeenCalled()
  })

  it('leaves out the email line when the account says no email, and Pay still goes to Checkout', async () => {
    page.account = {
      status: 'signedIn',
      id: 'userA',
      email: '',
      marketingEmail: false,
      showFartPlaces: true
    }
    const fetch = server()
    await render()
    await tapSave()
    expect(sheet()?.textContent).not.toContain('Buying for')
    expect(sheet()?.textContent).not.toContain('Checkout uses this email')
    await tapOnSheet('Pay $4.99')
    expect(asked(fetch, CHECKOUT_PATH)).toBe(1)
  })

  it('leaves out the email line with no account signed in, and Pay only closes the sheet', async () => {
    const fetch = server()
    await render()
    await tapSave()
    expect(sheet()?.textContent).toContain('Buying for a@example.test.')

    page.account = { status: 'expired' }
    await render()
    expect(sheet()?.textContent).not.toContain('Buying for')
    await tapOnSheet('Pay $4.99')
    expect(sheet()).toBeNull()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(page.saveToot).not.toHaveBeenCalled()
  })

  it('closes the sheet and says so when the session ended before Pay, with no charge started', async () => {
    const fetch = server({ checkout: { error: 'unauthorized' }, checkoutStatus: 401 })
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: window.location.origin,
      assign
    } as Location)
    await render()
    await tapSave()
    expect(sheet()?.textContent).toContain('Buying for a@example.test.')
    await tapOnSheet('Pay $4.99')
    expect(asked(fetch, CHECKOUT_PATH)).toBe(1)
    expect(sheet()).toBeNull()
    expect(container.textContent).toContain("Couldn't start the payment.")
    expect(assign).not.toHaveBeenCalled()
    expect(page.saveToot).not.toHaveBeenCalled()
  })

  it('goes to Checkout from Pay, and stays busy while the page goes', async () => {
    const fetch = server()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: window.location.origin,
      assign
    } as Location)
    await render()
    await payOnTheSheet()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(1)
    const body = fetch.mock.calls.find(([input]) => String(input) === CHECKOUT_PATH)?.[1]?.body
    expect(JSON.parse(String(body))).toEqual({ tootId: TOOT, songId: 'twinkle' })
    expect(assign).toHaveBeenCalledWith(STRIPE_PAGE)
    expect(saveButton().disabled).toBe(true)
    expect(page.saveToot).not.toHaveBeenCalled()
  })

  it('saves nothing and starts no Checkout on Not now, and Save offers again', async () => {
    const fetch = server()
    await render()
    await tapSave()
    await tapOnSheet('Not now')
    expect(sheet()).toBeNull()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(page.saveToot).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(false)
    await tapSave()
    expect(sheet()).not.toBeNull()
  })

  it('saves instead of paying twice when Pay finds Full Access has started', async () => {
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: window.location.origin,
      assign
    } as Location)
    server({ checkout: { active: true } })
    await render()
    await payOnTheSheet()
    expect(assign).not.toHaveBeenCalled()
    expect(sheet()).toBeNull()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
  })

  it('says an account with Full Access has kept as many Toots as it can', async () => {
    server({ access: { active: true, limitReached: true } })
    await render()
    await tapSave()
    expect(sheet()).toBeNull()
    expect(page.saveToot).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "You've kept as many Toots as an account can. Delete one to save this one."
    )
  })

  it('says so when Farty can’t say whether the account has Full Access', async () => {
    const fetch = server({ access: { error: 'internal' }, accessStatus: 500 })
    await render()
    await tapSave()
    expect(sheet()).toBeNull()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(page.saveToot).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Couldn't reach your account. Tap Save to try again.")
    expect(saveButton().disabled).toBe(false)
  })

  it('says payments aren’t available when the server has none (payments_unavailable)', async () => {
    const fetch = server({ checkout: { error: 'payments_unavailable' }, checkoutStatus: 503 })
    await render()
    await payOnTheSheet()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(1)
    expect(sheet()).toBeNull()
    expect(container.textContent).toContain("Payments aren't available right now.")
    expect(saveButton().disabled).toBe(false)
  })

  it('starts no Checkout when the take can’t be kept to make again back from it (ADR 0017)', async () => {
    const fetch = server()
    const keep = vi.fn(() => false)
    const { SaveToToots } = await import('./song-creator')
    await act(async () => root?.render(<SaveToToots draft={draft} back={null} keep={keep} />))
    await payOnTheSheet()
    expect(keep).toHaveBeenCalledOnce()
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(sheet()).toBeNull()
    expect(container.textContent).toContain(
      "This take can't be saved in this browser: it can't keep the take while you pay."
    )
    expect(saveButton().disabled).toBe(false)
  })

  it('says to try later past the checkout limit', async () => {
    server({ checkout: { error: 'rate_limited' }, checkoutStatus: 429 })
    await render()
    await payOnTheSheet()
    expect(container.textContent).toContain("You've started a lot of payments. Try again later.")
  })

  it('says the user was charged and links Support when the paid session doesn’t match (payment_mismatch)', async () => {
    server({ checkout: { error: 'payment_mismatch' }, checkoutStatus: 409 })
    await render()
    await payOnTheSheet()
    expect(container.textContent).toContain(
      "You were charged, but Full Access didn't start. Contact support for a refund."
    )
    // next/link drops the trailing slash outside a Next build, which adds it back (trailingSlash).
    const link = [...container.querySelectorAll('a')].find(a => a.textContent === 'Contact support')
    expect(link?.getAttribute('href')).toMatch(/^\/support\/?$/)
  })

  it('says the payment hasn’t come through yet, back from Checkout, and checks again on Save', async () => {
    const { waitForFullAccess } = await import('@/lib/full-access')
    await render({ tootId: TOOT, done: true })
    expect(waitForFullAccess).toHaveBeenCalledWith('userA')
    expect(container.textContent).toContain(
      "Your payment hasn't come through yet. Tap Save to check again."
    )
    expect(page.saveToot).not.toHaveBeenCalled()

    // Paid by now: Save asks the server, which says so, and saves.
    server({ access: { active: true } })
    await tapSave()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
  })

  it('waits on a payment made at an offer, and never opens the sheet that starts another', async () => {
    const { waitForFullAccess } = await import('@/lib/full-access')
    notePaymentPending('userA')
    server({ access: { active: false } })
    await render()
    await tapSave()
    expect(waitForFullAccess).toHaveBeenCalledWith('userA')
    expect(sheet()).toBeNull()
    expect(page.saveToot).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "Your payment hasn't come through yet. Tap Save to check again."
    )

    // It's through: the same tap saves.
    vi.mocked(waitForFullAccess).mockResolvedValueOnce('save')
    await tapSave()
    expect(sheet()).toBeNull()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
    clearPaymentPending()
  })

  it('still offers it to another account in this browser', async () => {
    notePaymentPending('userB')
    server({ access: { active: false } })
    await render()
    await tapSave()
    expect(sheet()).not.toBeNull()
    clearPaymentPending()
  })

  it('saves by itself back from Checkout once the account has Full Access', async () => {
    const { waitForFullAccess, clearCheckoutReturn } = await import('@/lib/full-access')
    vi.mocked(waitForFullAccess).mockResolvedValueOnce('save')
    await render({ tootId: TOOT, done: true })
    expect(page.saveToot).toHaveBeenCalledWith(draft)
    expect(clearCheckoutReturn).toHaveBeenCalled()
  })

  it('says the Toot limit back from Checkout, rather than saving what can’t upload', async () => {
    const { waitForFullAccess } = await import('@/lib/full-access')
    vi.mocked(waitForFullAccess).mockResolvedValueOnce('limitReached')
    await render({ tootId: TOOT, done: true })
    expect(page.saveToot).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "You've kept as many Toots as an account can. Delete one to save this one."
    )
  })

  it('offers a retry when the account can’t be read after a paid return', async () => {
    page.account = { status: 'unreachable' }
    const fetch = vi.spyOn(globalThis, 'fetch')
    await render({ tootId: TOOT, done: true })
    expect(container.textContent).toContain("Couldn't reach your account. Tap Save to try again.")
    expect(saveButton().disabled).toBe(false)
    await tapSave()
    expect(page.retry).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()

    // Read again and signed in: the return confirms the payment by itself.
    const { waitForFullAccess } = await import('@/lib/full-access')
    page.account = {
      status: 'signedIn',
      id: 'userA',
      email: 'a@example.test',
      marketingEmail: false,
      showFartPlaces: true
    }
    await render({ tootId: TOOT, done: true })
    expect(waitForFullAccess).toHaveBeenCalledWith('userA')
  })

  it('reads the account again when Save is tapped while it can’t be read', async () => {
    page.account = { status: 'unreachable' }
    await render()
    expect(container.textContent).not.toContain("Couldn't reach your account.")
    await tapSave()
    expect(page.retry).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("Couldn't reach your account. Tap Save to try again.")
    page.account = {
      status: 'signedIn',
      id: 'userA',
      email: 'a@example.test',
      marketingEmail: false,
      showFartPlaces: true
    }
    await render()
    expect(container.textContent).not.toContain("Couldn't reach your account.")
  })
})

describe('Save to Toots, as a guest', () => {
  beforeEach(() => {
    page.account = { status: 'signedOut' }
    page.openStep.mockImplementation(() => {
      page.stepOpen = true
    })
  })

  const signedIn: Account = {
    status: 'signedIn',
    id: 'userA',
    email: 'a@example.test',
    marketingEmail: false,
    showFartPlaces: true
  }

  it('asks for an account before saving, where saving is free', async () => {
    page.paid = false
    const fetch = server()
    await render()
    expect(saveButton().textContent).toBe('Save to Toots')
    await tapSave()
    expect(page.openStep).toHaveBeenCalledOnce()
    expect(page.saveToot).not.toHaveBeenCalled()

    // The step signs in and closes: straight to saving.
    page.account = signedIn
    page.stepOpen = false
    await render()
    expect(fetch).not.toHaveBeenCalled()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
  })

  it('asks for an account before offering anything, where saving is paid', async () => {
    const fetch = server()
    await render()
    expect(saveButton().textContent).toBe('Save to Toots')
    await tapSave()
    expect(page.openStep).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(sheet()).toBeNull()

    // The step signs in and closes: on to the offer, under the account just made, and on to Pay.
    page.account = signedIn
    page.stepOpen = false
    await render()
    expect(asked(fetch, ACCESS_PATH)).toBe(1)
    expect(asked(fetch, CHECKOUT_PATH)).toBe(0)
    expect(sheet()?.textContent).toContain('Buying for a@example.test.')
    expect(page.saveToot).not.toHaveBeenCalled()
    await tapOnSheet('Pay $4.99')
    expect(asked(fetch, CHECKOUT_PATH)).toBe(1)
  })

  it('saves once the step signs in to an account with Full Access', async () => {
    server({ access: { active: true } })
    await render()
    await tapSave()
    page.account = signedIn
    page.stepOpen = false
    await render()
    expect(sheet()).toBeNull()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
  })

  it('saves nothing when the step closes with Not now', async () => {
    page.paid = false
    await render()
    await tapSave()
    page.stepOpen = false
    await render()
    page.account = {
      status: 'signedIn',
      id: 'userA',
      email: 'a@example.test',
      marketingEmail: false,
      showFartPlaces: true
    }
    // Signed in later, from Profile: Save waits for its own tap.
    await render()
    expect(page.saveToot).not.toHaveBeenCalled()
  })
})

describe('Save to Toots, where saving is free, while the account can’t be read', () => {
  beforeEach(() => {
    page.paid = false
    page.account = { status: 'unreachable' }
  })
  afterEach(() => localStorage.clear())

  it('saves in a browser whose library is an account’s, as offline before #237', async () => {
    localStorage.setItem('pedos.account', 'userA')
    await render()
    await tapSave()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
    expect(page.retry).not.toHaveBeenCalled()
  })

  it('reads the account again in a guest’s browser, and saves nothing', async () => {
    await render()
    await tapSave()
    expect(page.saveToot).not.toHaveBeenCalled()
    expect(page.retry).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("Couldn't reach your account. Tap Save to try again.")
  })
})
