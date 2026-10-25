import { expect, type Page } from '@playwright/test'

// Paying to save a Toot (ADR 0010) in the journeys. A local run has no Stripe key, so Save goes to
// the dev checkout (`/dev/checkout/`), whose Pay stands in for Stripe Checkout's.

/** The dev checkout is open: its Pay, and back to Song Creator, which saves the Toot. */
export async function payAtTheDevCheckout(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dev\/checkout\/\?toot=[\w-]+&song=\w+$/)
  await page.getByRole('button', { name: 'Pay $0.99' }).click()
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled({
    timeout: 60_000
  })
  await expect(page).toHaveURL(/\/compose\/\w+\/$/)
}

/** Saves the Toot on Song Creator, signed in: Save, then the dev checkout's Pay. */
export async function payToSave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save to Toots · $0.99' }).click()
  await payAtTheDevCheckout(page)
}
