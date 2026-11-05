import type { SiteEnv } from './site'

// What saving Toots costs (ADR 0022). Making and hearing them is free; Save to Toots needs Full
// Access, one payment per account, through Stripe Checkout. The browser and the server both read
// this file.

/** The price of Full Access, in the currency's smallest unit. The one place it is set. */
export const FULL_ACCESS_PRICE = { amount: 499, currency: 'usd' } as const

/** The price as people read it: "$4.99". */
export const FULL_ACCESS_PRICE_LABEL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: FULL_ACCESS_PRICE.currency
}).format(FULL_ACCESS_PRICE.amount / 100)

/** How many days after paying someone can have their money back, by asking Support. */
export const MONEY_BACK_DAYS = 14

/**
 * Where Save to Toots is free: nowhere since #258, when Production took Stripe's live keys. Putting
 * `'production'` back makes saving free there again, on the browser's side and the server's (the
 * `free` kind of `Payments` in `src/server/stripe.ts`).
 */
const FREE_SAVING: readonly SiteEnv[] = []

/**
 * Whether Save to Toots needs Full Access in `environment`: everywhere outside `FREE_SAVING`,
 * Production included, in Stripe's live mode (ADR 0022).
 */
export function savingIsPaid(environment: SiteEnv): boolean {
  return !FREE_SAVING.includes(environment)
}

/**
 * The environment this build is for: `PEDOS_ENVIRONMENT`, which `next.config.ts` inlines from
 * `SITE_ENV` at build time. The browser's Save goes by it, and so does a local run's server, so a
 * Production build run locally pays to save, as Production does, on both sides.
 */
export function builtFor(): SiteEnv {
  const env = process.env.PEDOS_ENVIRONMENT
  return env === 'staging' || env === 'production' ? env : 'local'
}
