/**
 * The steps of Farty's funnel (#405): how far new phone visitors get, from first open to paid.
 * Shared by the browser (`steps.ts`), the route and the server, so the allowlist is one list.
 *
 * A step is only a name. It's never tied to a person, an account, a session or a device.
 */

/** What a browser counts, once each (`steps.ts`). The route refuses any other name. */
export const BROWSER_STEPS = [
  /** Welcome first shows on a phone. */
  'open',
  /** The microphone is first allowed. */
  'mic-allowed',
  /** The first Recording is saved. */
  'first-recording',
  /** First signed in, at the account step. */
  'account',
  /** A Toot of a Song is first played. */
  'song-heard',
  /** Save is first tapped on a Song's or Sound Pad's Toot. */
  'save-tapped',
  /** Welcome's Full Access button first shows (#407). */
  'offer-welcome-shown',
  /** Welcome's Full Access button is first tapped. Its sheet's Pay shows only in `checkout-started`. */
  'offer-welcome-tapped',
  /** The first Result's Full Access sheet opens. */
  'offer-result-shown',
  /** Pay is tapped on the first Result's Full Access sheet. */
  'offer-result-tapped'
] as const

export type BrowserStep = (typeof BROWSER_STEPS)[number]

/** What the server counts, each time it happens: no browser can send these. */
export const SERVER_STEPS = [
  /** A Checkout Session is created. */
  'checkout-started',
  /** A payment is first marked paid. */
  'paid'
] as const

export type Step = BrowserStep | (typeof SERVER_STEPS)[number]

/** The most a step's body may be. A real one is about 20 bytes. */
export const STEP_MAX_BYTES = 128

export function isBrowserStep(value: unknown): value is BrowserStep {
  return typeof value === 'string' && (BROWSER_STEPS as readonly string[]).includes(value)
}

/** The step in `value`, or null when it isn't exactly `{ step }` with a browser's step. */
export function parseStep(value: unknown): BrowserStep | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).length !== 1 || !isBrowserStep(fields.step)) return null
  return fields.step
}
