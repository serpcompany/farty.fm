// Where Full Access is offered before Save (#407): a second button on Welcome, and at the first
// Result. Both can be skipped. The server reads the places and their returns, and the browser the
// rest: Checkout comes back to a fixed address per place, never one a request names.

export const OFFER_PLACES = ['welcome', 'result'] as const

export type OfferPlace = (typeof OFFER_PLACES)[number]

export function isOfferPlace(value: unknown): value is OfferPlace {
  return (OFFER_PLACES as readonly unknown[]).includes(value)
}

/**
 * What Checkout comes back to. Welcome's is the first screen, which Welcome still covers. A Result's
 * is the Recordings tab, so the return never opens the microphone.
 */
const RETURN_PATHS: Record<OfferPlace, string> = { welcome: '/', result: '/recordings/' }

/** The address Checkout returns to from an offer: paid (`done`), or cancelled. */
export function offerReturnPath(place: OfferPlace, done: boolean): string {
  const params = new URLSearchParams({ offer: place })
  if (done) params.set('checkout', 'done')
  return `${RETURN_PATHS[place]}?${params}`
}

/** Back from Checkout: which offer it was for, and whether it says it's paid. */
export type OfferReturn = { place: OfferPlace; done: boolean }

/**
 * This address as a return from an offer's Checkout (`offerReturnPath`), or null for any other, such
 * as the dev checkout's own page, which names its offer too.
 */
export function readOfferReturn(
  { pathname, search }: Pick<Location, 'pathname' | 'search'> = window.location
): OfferReturn | null {
  const params = new URLSearchParams(search)
  const place = params.get('offer')
  if (!isOfferPlace(place) || pathname !== RETURN_PATHS[place]) return null
  return { place, done: params.get('checkout') === 'done' }
}

/** Takes the return's query off the address, so a reload doesn't confirm again. */
export function clearOfferReturn(): void {
  if (readOfferReturn() === null) return
  window.history.replaceState(null, '', window.location.pathname)
}

const resultOfferKey = 'pedos.fullAccessOffer'

/**
 * Whether the first Result still offers Full Access, remembering that it did. With storage blocked
 * Farty can't remember, so it never offers: Save still does.
 */
export function takeResultOffer(): boolean {
  try {
    if (localStorage.getItem(resultOfferKey) !== null) return false
    localStorage.setItem(resultOfferKey, 'offered')
    return true
  } catch {
    return false
  }
}

const nextKey = 'pedos.offerNext'

/** Where a Result's tap was going, kept while Checkout's page has this one gone. */
export function keepOfferNext(href: string): void {
  try {
    sessionStorage.setItem(nextKey, href)
  } catch {
    // Without it, the return stays on the Recordings tab, where Done goes.
  }
}

/** Where a Result's tap was going, once. Null if it wasn't kept. */
export function takeOfferNext(): string | null {
  try {
    const href = sessionStorage.getItem(nextKey)
    sessionStorage.removeItem(nextKey)
    return href
  } catch {
    return null
  }
}
