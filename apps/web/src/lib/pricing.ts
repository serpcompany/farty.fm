import type { SiteEnv } from './site'

export const TOOT_PRICE = { amount: 99, currency: 'usd' } as const

export const TOOT_PRICE_LABEL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: TOOT_PRICE.currency
}).format(TOOT_PRICE.amount / 100)

const FREE_SAVING: readonly SiteEnv[] = []

export function savingIsPaid(environment: SiteEnv): boolean {
  return !FREE_SAVING.includes(environment)
}

export function builtFor(): SiteEnv {
  const env = process.env.FARTY_ENVIRONMENT
  return env === 'staging' || env === 'production' ? env : 'local'
}
