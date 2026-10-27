import { answer, send } from './library-api'
import { builtFor, savingIsPaid } from './pricing'

// Paying to save a Toot, from the browser (ADR 0010): Song Creator starts a Checkout for the Toot
// (`/api/toots/{id}/checkout/`), the browser goes to Stripe's page, and Stripe sends it back to
// the Song's Song Creator with the Toot's id, which makes the same Toot again and saves it once
// the server says it's paid (`/api/toots/{id}/payment/`).

/** Whether this build's Save to Toots asks for a payment first: the environment it's built for. */
export function saveAsksForPayment(): boolean {
  return savingIsPaid(builtFor())
}

/**
 * How starting to pay went: go to Checkout's page, or there's nothing to pay, or another Toot of
 * the Song is paid for and was never saved (`tootId`), or it failed. `charged` is a payment Stripe
 * took that doesn't match the Toot's price, which only support can sort out.
 */
export type Checkout =
  | { kind: 'pay'; url: string }
  | { kind: 'paid' }
  | { kind: 'paidToot'; tootId: string }
  | { kind: 'failed'; problem: 'unavailable' | 'limitReached' | 'charged' | 'tooMany' | 'failed' }

/** Stripe's page, or the dev checkout on this same site. Nothing else is gone to. */
function isCheckoutPage(url: string): boolean {
  if (!URL.canParse(url)) return false
  const { origin, pathname } = new URL(url)
  if (origin === 'https://checkout.stripe.com') return true
  return origin === window.location.origin && pathname === '/dev/checkout/'
}

/** Starts paying to save the Toot `tootId` of `songId`, as `accountId`. */
export async function startCheckout(
  tootId: string,
  songId: string,
  accountId: string
): Promise<Checkout> {
  const response = await send(`/api/toots/${tootId}/checkout/`, accountId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId })
  })
  if (response?.ok) {
    const body = (await response.json().catch(() => null)) as {
      url?: unknown
      paid?: unknown
      paidToot?: unknown
    } | null
    if (body?.paid === true) return { kind: 'paid' }
    if (typeof body?.paidToot === 'string' && TOOT_ID.test(body.paidToot)) {
      return { kind: 'paidToot', tootId: body.paidToot }
    }
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

/** Whether the Toot is paid for, or null when Farty couldn't say. */
export async function tootPaid(tootId: string, accountId: string): Promise<boolean | null> {
  const response = await send(`/api/toots/${tootId}/payment/`, accountId)
  if (!response?.ok) return null
  const body = (await response.json().catch(() => null)) as { paid?: unknown } | null
  return typeof body?.paid === 'boolean' ? body.paid : null
}

/** How long the return from Checkout waits for the payment: Stripe usually says in a second. */
export const PAYMENT_WAIT = { tries: 15, intervalMs: 2000 }

/** Asks until the Toot is paid, `PAYMENT_WAIT.tries` times at most. True once it is. */
export async function waitUntilPaid(
  tootId: string,
  accountId: string,
  wait = PAYMENT_WAIT
): Promise<boolean> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, wait.intervalMs))
    if (await tootPaid(tootId, accountId)) return true
  }
  return false
}

/** Back from Checkout: the Toot it was for, and whether it says it's paid. */
export type CheckoutReturn = { tootId: string; done: boolean }

const TOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Song Creator's address after Checkout: `?toot=<id>&checkout=done` once paid, `?toot=<id>` when
 * cancelled. Null for any other.
 */
export function readCheckoutReturn(search = window.location.search): CheckoutReturn | null {
  const params = new URLSearchParams(search)
  const tootId = params.get('toot')
  if (tootId === null || !TOOT_ID.test(tootId)) return null
  return { tootId, done: params.get('checkout') === 'done' }
}

/** Song Creator's address back from a paid Checkout for the Toot `tootId` of `songId`. */
export function paidReturnPath(songId: string, tootId: string): string {
  return `/compose/${songId}/?${new URLSearchParams({ toot: tootId, checkout: 'done' })}`
}

/** Takes the return's query off the address, so a reload makes a new Toot. */
export function clearCheckoutReturn(): void {
  if (readCheckoutReturn() === null) return
  window.history.replaceState(null, '', window.location.pathname)
}
