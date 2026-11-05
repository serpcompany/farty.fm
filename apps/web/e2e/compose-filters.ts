import { expect, type Page } from '@playwright/test'

/** Compose's Kind or Show dropdown, under the name it has now: "Kind", or "Kind: Kids, Hymns". */
export const dropdown = (page: Page, name: 'Kind' | 'Show') =>
  page.getByTestId('song-filters').getByRole('button', { name: new RegExp(`^${name}(:|$)`) })

/** A row of the open Kind or Show menu. */
export const menuRow = (page: Page, name: string) =>
  page.getByRole('menuitemcheckbox', { name, exact: true })

/** Taps each of `rows` in a dropdown's menu, which stays open for them, and closes it. */
export async function pick(page: Page, name: 'Kind' | 'Show', ...rows: string[]) {
  await dropdown(page, name).click()
  for (const row of rows) await menuRow(page, row).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}
