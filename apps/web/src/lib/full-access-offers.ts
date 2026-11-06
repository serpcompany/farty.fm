// What this browser remembers about the two offers of Full Access before Save (#407, ADR 0022): on
// Welcome and at the first Result. Each gets one go in a browser, and a payment made from one is
// remembered until the account has it, so nothing offers Pay again while it's on its way.

export type OfferPlace = 'welcome' | 'result'

export const offerKey = (place: OfferPlace) => `pedos.fullAccessOffer.${place}`

/** Whether `place` has had its go here. With storage blocked it can't tell, so it never offers. */
export function offerWasSeen(place: OfferPlace): boolean {
  try {
    return localStorage.getItem(offerKey(place)) !== null
  } catch {
    return true
  }
}

export function markOfferSeen(place: OfferPlace): void {
  try {
    localStorage.setItem(offerKey(place), '1')
  } catch {
    // It can't be kept, and `offerWasSeen` already says yes without storage.
  }
}

/** Whether this address is Checkout's return from paying at an offer. */
export function readOfferReturn(search = window.location.search): boolean {
  return new URLSearchParams(search).get('offer') === 'done'
}

/** Takes the return off the address, so a reload doesn't wait for a payment again. */
export function clearOfferReturn(): void {
  const address = new URL(window.location.href)
  address.searchParams.delete('offer')
  window.history.replaceState(null, '', address)
}

const pendingKey = 'pedos.fullAccess.paymentPending'
/**
 * How long a payment that hasn't come through stops Pay being offered here. Cards pay at once, so a
 * payment this late isn't coming, and the account has to be able to try again.
 */
export const PAYMENT_PENDING_MS = 60 * 60 * 1000

/** `accountId` came back from an offer's Checkout: from now until it has Full Access, no Pay. */
export function notePaymentPending(accountId: string, now = Date.now()): void {
  try {
    localStorage.setItem(pendingKey, JSON.stringify({ accountId, at: now }))
  } catch {
    // It can't be kept, so only the return's own wait stands.
  }
}

/** Whether `accountId` paid at an offer and it hasn't come through yet. */
export function paymentPending(accountId: string, now = Date.now()): boolean {
  try {
    const pending = JSON.parse(localStorage.getItem(pendingKey) ?? 'null') as {
      accountId?: unknown
      at?: unknown
    } | null
    return (
      pending?.accountId === accountId &&
      typeof pending.at === 'number' &&
      now - pending.at < PAYMENT_PENDING_MS
    )
  } catch {
    return false
  }
}

export function clearPaymentPending(): void {
  try {
    localStorage.removeItem(pendingKey)
  } catch {
    // Nothing was kept.
  }
}
