import type { SiteEnv } from './site'

// What saving a Toot costs (ADR 0010). Making and hearing one is free; Save to Toots is paid, one
// Toot at a time, through Stripe Checkout. The browser and the server both read this file.

/** The price of saving one Toot, in the currency's smallest unit. The one place it is set. */
export const TOOT_PRICE = { amount: 99, currency: 'usd' } as const

/** The price as people read it: "$0.99". */
export const TOOT_PRICE_LABEL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: TOOT_PRICE.currency
}).format(TOOT_PRICE.amount / 100)

/**
 * Whether Save to Toots costs `TOOT_PRICE` in `environment`. Production keeps saving free until the
 * owner changes this, once its Worker has Stripe's live keys (ADR 0010).
 */
export function savingIsPaid(environment: SiteEnv): boolean {
  return environment !== 'production'
}

/**
 * The environment this build is for: `PEDOS_ENVIRONMENT`, which `next.config.ts` inlines from
 * `SITE_ENV` at build time. The browser's Save goes by it, and so does a local run's server, so a
 * Production build run locally saves free on both sides.
 */
export function builtFor(): SiteEnv {
  const env = process.env.PEDOS_ENVIRONMENT
  return env === 'staging' || env === 'production' ? env : 'local'
}
