import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/lib/account'
import { songs } from '@/lib/catalog/songs.generated'
import type { TootDraft } from '@/lib/toot'
import type { CheckoutReturn } from '@/lib/toot-payment'

// Song Creator's Save where saving is paid (ADR 0010, #213), in a DOM: what Save says when
// payments are off or limited, when the payment hasn't come through, and when the account can't be
// read after a paid return; and that a paid Toot never saved is saved instead of paying twice. The
// server is `fetch`, answering as the routes do.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TOOT = '33333333-3333-4333-8333-333333333333'
const PAID_TOOT = '44444444-4444-4444-8444-444444444444'

const page = vi.hoisted(() => ({
  account: {
    status: 'signedIn',
    id: 'userA',
    email: 'a@example.test',
    marketingEmail: false
  } as Account,
  retry: vi.fn(),
  openStep: vi.fn(),
  saveToot: vi.fn(),
  saved: false
}))

vi.mock('./account-provider', () => ({
  useAccount: () => ({
    account: page.account,
    stepOpen: false,
    offerStep: vi.fn(),
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
vi.mock('@/lib/toot-payment', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/toot-payment')>()),
  // Saving is paid in this build, and the wait for a payment is cut short.
  saveAsksForPayment: () => true,
  waitUntilPaid: vi.fn(async () => false),
  clearCheckoutReturn: vi.fn()
}))

const song = songs.find(s => s.id === 'twinkle')
if (!song) throw new Error('twinkle is in the catalog')
const draft: TootDraft = {
  id: TOOT,
  song,
  arrangement: { transposition: 0, recordingForPitch: {} },
  seconds: 1,
  wav: new ArrayBuffer(0)
}

let root: Root | null = null
let container: HTMLDivElement

async function render(back: CheckoutReturn | null = null) {
  const { Ready } = await import('./song-creator')
  await act(async () => root?.render(<Ready draft={draft} back={back} />))
}

/** The server answers the checkout with `body`, at `status`. */
function checkoutAnswers(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json(body, { status }))
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

beforeEach(() => {
  page.account = { status: 'signedIn', id: 'userA', email: 'a@example.test', marketingEmail: false }
  page.saved = false
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
  it('says payments aren’t available when the server has none (payments_unavailable)', async () => {
    const fetch = checkoutAnswers({ error: 'payments_unavailable' }, 503)
    await render()
    expect(saveButton().textContent).toBe('Save to Toots · $0.99')
    await tapSave()
    expect(fetch).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("Payments aren't available right now.")
    expect(saveButton().disabled).toBe(false)
  })

  it('says to try later past the checkout limit', async () => {
    checkoutAnswers({ error: 'rate_limited' }, 429)
    await render()
    await tapSave()
    expect(container.textContent).toContain("You've started a lot of payments. Try again later.")
  })

  it('says the payment hasn’t come through yet, back from Checkout, and checks again on Save', async () => {
    const { waitUntilPaid } = await import('@/lib/toot-payment')
    await render({ tootId: TOOT, done: true })
    expect(waitUntilPaid).toHaveBeenCalledWith(TOOT, 'userA')
    expect(container.textContent).toContain(
      "Your payment hasn't come through yet. Tap Save to check again."
    )
    expect(page.saveToot).not.toHaveBeenCalled()

    // Paid by now: Save asks the server, which says so, and saves.
    checkoutAnswers({ paid: true })
    await tapSave()
    expect(page.saveToot).toHaveBeenCalledWith(draft)
  })

  it('saves a paid Toot of the Song never saved, instead of paying again', async () => {
    checkoutAnswers({ paidToot: PAID_TOOT })
    const replace = vi.fn()
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: window.location.origin,
      replace,
      assign
    } as Location)
    await render()
    await tapSave()
    expect(replace).toHaveBeenCalledWith(`/compose/twinkle/?toot=${PAID_TOOT}&checkout=done`)
    expect(assign).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(true)
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
    const { waitUntilPaid } = await import('@/lib/toot-payment')
    page.account = {
      status: 'signedIn',
      id: 'userA',
      email: 'a@example.test',
      marketingEmail: false
    }
    await render({ tootId: TOOT, done: true })
    expect(waitUntilPaid).toHaveBeenCalledWith(TOOT, 'userA')
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
      marketingEmail: false
    }
    await render()
    expect(container.textContent).not.toContain("Couldn't reach your account.")
  })
})
