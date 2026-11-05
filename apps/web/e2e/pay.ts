import { expect, type Page } from '@playwright/test'

// Paying for Full Access (ADR 0022) in the journeys. A local run has no Stripe key, so the sheet's
// Pay goes to the dev checkout (`/dev/checkout/`), whose Pay stands in for Stripe Checkout's. A
// Song's id can have hyphens, such as `hot-cross-buns` (#229).

/**
 * The dev checkout is open: its Pay, and back to Song Creator, or with `from: 'pad'` to the Sound
 * Pad (ADR 0017), which saves the Toot.
 */
export async function payAtTheDevCheckout(
  page: Page,
  from: 'song' | 'pad' = 'song'
): Promise<void> {
  await expect(page).toHaveURL(
    from === 'pad'
      ? /\/dev\/checkout\/\?toot=[\w-]+$/
      : /\/dev\/checkout\/\?toot=[\w-]+&song=[\w-]+$/
  )
  await page.getByRole('button', { name: 'Pay $4.99' }).click()
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled({
    timeout: 60_000
  })
  await expect(page).toHaveURL(from === 'pad' ? /\/compose\/pad\/$/ : /\/compose\/[\w-]+\/$/)
}

/** The Full Access sheet is open: its Pay, on to the dev checkout. */
export async function payOnTheSheet(page: Page): Promise<void> {
  await page.getByTestId('full-access-sheet').getByRole('button', { name: 'Pay $4.99' }).click()
}

/** Saves the Toot, signed in without Full Access: Save, the sheet's Pay, the dev checkout's Pay. */
export async function payToSave(page: Page, from: 'song' | 'pad' = 'song'): Promise<void> {
  await page.getByRole('button', { name: 'Save to Toots' }).click()
  await payOnTheSheet(page)
  await payAtTheDevCheckout(page, from)
}

/** Saves the Toot on an account with Full Access: Save, with nothing to pay. */
export async function saveWithFullAccess(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save to Toots' }).click()
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled({
    timeout: 60_000
  })
  await expect(page.getByTestId('full-access-sheet')).toBeHidden()
}

/** Saves the Toot on an account that may or may not have Full Access yet, paying if it's asked. */
export async function savePayingIfAsked(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save to Toots' }).click()
  const sheet = page.getByTestId('full-access-sheet')
  const saved = page.getByRole('button', { name: 'Saved to Toots' })
  await expect(sheet.or(saved)).toBeVisible({ timeout: 60_000 })
  if (!(await sheet.isVisible())) return
  await payOnTheSheet(page)
  await payAtTheDevCheckout(page)
}
