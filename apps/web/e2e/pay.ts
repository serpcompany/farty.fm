import type { Page } from '@playwright/test'
import { expect } from './test'

export async function payAtTheDevCheckout(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dev\/checkout\/\?toot=[\w-]+&song=\w+$/)
  await page.getByRole('button', { name: 'Pay $0.99' }).click()
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled({
    timeout: 60_000
  })
  await expect(page).toHaveURL(/\/compose\/\w+\/$/)
}

export async function payToSave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save to Toots · $0.99' }).click()
  await payAtTheDevCheckout(page)
}
