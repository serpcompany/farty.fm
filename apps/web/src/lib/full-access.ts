import { answer, send } from './library-api'
import { builtFor, savingIsPaid } from './pricing'

// Full Access from the browser (ADR 0022): Save on Song Creator, or the Sound Pad for a Toot of its
// Performance (ADR 0017), asks whether the account has it (`/api/full-access/`). Without it, the
// browser goes to pay (`/api/full-access/checkout/`), and Stripe sends it back to the screen it came
// from with the Toot's id, which makes the same Toot again and saves it once the account has it.

/** Whether this build's Save to Toots asks for Full Access first: the environment it's built for. */
export function saveAsksForPayment(): boolean {
  return savingIsPaid(builtFor())
}

/**
 * How starting to pay went: go to Checkout's page, or the account has Full Access already, or it
 * failed. `charged` is a payment Stripe took that doesn't match its price, which only support can
 * sort out.
 */
export type Checkout =
  | { kind: 'pay'; url: string }
  | { kind: 'active' }
  | { kind: 'failed'; problem: 'unavailable' | 'limitReached' | 'charged' | 'tooMany' | 'failed' }

/** Stripe's page, or the dev checkout on this same site. Nothing else is gone to. */
function isCheckoutPage(url: string): boolean {
  if (!URL.canParse(url)) return false
  const { origin, pathname } = new URL(url)
  if (origin === 'https://checkout.stripe.com') return true
  return origin === window.location.origin && pathname === '/dev/checkout/'
}

/**
 * Starts paying for Full Access as `accountId`, coming back to the Toot `tootId` of `songId`, or of
 * a Sound Pad Performance with a null `songId`.
 */
export async function startCheckout(
  tootId: string,
  songId: string | null,
  accountId: string
): Promise<Checkout> {
  const response = await send('/api/full-access/checkout/', accountId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tootId, songId })
  })
  if (response?.ok) {
    const body = (await response.json().catch(() => null)) as {
      url?: unknown
      active?: unknown
    } | null
    if (body?.active === true) return { kind: 'active' }
    if (typeof body?.url === 'string' && isCheckoutPage(body.url)) {
      return { kind: 'pay', url: body.url }
    }
    return { kind: 'failed', problem: 'failed' }
  }
  const { status, error } = await answer(response)
  if (status === 503) return { kind: 'failed', problem: 'unavailable' }
  if (status === 409 && error === 'limit_reached') {
    return { kind: 'failed', problem: 'limitReached' }
  }
  if (status === 409 && error === 'payment_mismatch') return { kind: 'failed', problem: 'charged' }
  if (status === 429) return { kind: 'failed', problem: 'tooMany' }
  return { kind: 'failed', problem: 'failed' }
}

/** The account's Full Access as the server says it, or null when Farty couldn't say. */
async function askFullAccess(
  path: string,
  accountId: string
): Promise<{ active: boolean; limitReached: boolean } | null> {
  const response = await send(path, accountId)
  if (!response?.ok) return null
  const body = (await response.json().catch(() => null)) as {
    active?: unknown
    limitReached?: unknown
  } | null
  if (typeof body?.active !== 'boolean') return null
  return { active: body.active, limitReached: body.limitReached === true }
}

/**
 * What Save does on this account: `save`, it has Full Access; `offer`, it doesn't; `limitReached`,
 * it has Full Access and as many Toots as an account can keep. Null when Farty couldn't say.
 */
export async function saveCheck(
  accountId: string
): Promise<'save' | 'offer' | 'limitReached' | null> {
  const state = await askFullAccess('/api/full-access/', accountId)
  if (!state) return null
  if (!state.active) return 'offer'
  return state.limitReached ? 'limitReached' : 'save'
}

/**
 * Whether the account has Full Access, from what's stored, never asking Stripe (`?check=stored`), so
 * opening the Sound Pad never spends the checks a return from Checkout waits on. Null when Farty
 * couldn't say.
 */
export async function hasStoredFullAccess(accountId: string): Promise<boolean | null> {
  const state = await askFullAccess('/api/full-access/?check=stored', accountId)
  return state?.active ?? null
}

/** How long the return from Checkout waits for the payment: Stripe usually says in a second. */
export const PAYMENT_WAIT = { tries: 15, intervalMs: 2000 }

/** Asks until the account has Full Access, `PAYMENT_WAIT.tries` times at most. True once it has. */
export async function waitForFullAccess(accountId: string, wait = PAYMENT_WAIT): Promise<boolean> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, wait.intervalMs))
    if ((await askFullAccess('/api/full-access/', accountId))?.active) return true
  }
  return false
}

/** Back from Checkout: the Toot it was for, and whether it says it's paid. */
export type CheckoutReturn = { tootId: string; done: boolean }

const TOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Song Creator's or the Sound Pad's address after Checkout: `?toot=<id>&checkout=done` once paid,
 * `?toot=<id>` when cancelled. Null for any other.
 */
export function readCheckoutReturn(search = window.location.search): CheckoutReturn | null {
  const params = new URLSearchParams(search)
  const tootId = params.get('toot')
  if (tootId === null || !TOOT_ID.test(tootId)) return null
  return { tootId, done: params.get('checkout') === 'done' }
}

/** Takes the return's query off the address, so a reload makes a new Toot. */
export function clearCheckoutReturn(): void {
  if (readCheckoutReturn() === null) return
  window.history.replaceState(null, '', window.location.pathname)
}
