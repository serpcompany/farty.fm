import type { SiteEnv } from './site'

export const TOOT_PRICE = { amount: 99, currency: 'usd' } as const

export const TOOT_PRICE_LABEL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: TOOT_PRICE.currency
}).format(TOOT_PRICE.amount / 100)

export function savingIsPaid(environment: SiteEnv): boolean {
  return environment !== 'production'
}
