import { answer, send } from './library-api'
import { savingIsPaid } from './pricing'

export function saveAsksForPayment(): boolean {
  const env = process.env.PEDOS_ENVIRONMENT
  return savingIsPaid(env === 'staging' || env === 'production' ? env : 'local')
}

export type Checkout =
  | { kind: 'pay'; url: string }
  | { kind: 'paid' }
  | { kind: 'failed'; problem: 'unavailable' | 'limitReached' | 'failed' }

function isCheckoutPage(url: string): boolean {
  if (!URL.canParse(url)) return false
  const { origin, pathname } = new URL(url)
  if (origin === 'https://checkout.stripe.com') return true
  return origin === window.location.origin && pathname === '/dev/checkout/'
}

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
    } | null
    if (body?.paid === true) return { kind: 'paid' }
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
  return { kind: 'failed', problem: 'failed' }
}

export async function tootPaid(tootId: string, accountId: string): Promise<boolean | null> {
  const response = await send(`/api/toots/${tootId}/payment/`, accountId)
  if (!response?.ok) return null
  const body = (await response.json().catch(() => null)) as { paid?: unknown } | null
  return typeof body?.paid === 'boolean' ? body.paid : null
}

const PAYMENT_WAIT = { tries: 15, intervalMs: 2000 }

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

export type CheckoutReturn = { tootId: string; done: boolean }

const TOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function readCheckoutReturn(search = window.location.search): CheckoutReturn | null {
  const params = new URLSearchParams(search)
  const tootId = params.get('toot')
  if (tootId === null || !TOOT_ID.test(tootId)) return null
  return { tootId, done: params.get('checkout') === 'done' }
}

export function clearCheckoutReturn(): void {
  if (readCheckoutReturn() === null) return
  window.history.replaceState(null, '', window.location.pathname)
}
