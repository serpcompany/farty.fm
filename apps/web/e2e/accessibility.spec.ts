import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { skipWelcome } from './record'
import { pageSettled, pagesOutsideTheTabs } from './screens'
import { expect, test } from './test'

const wcag21aa = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function violations(page: Page) {
  const found = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await pageSettled(page)
    const { violations } = await new AxeBuilder({ page }).withTags(wcag21aa).analyze()
    found.push(
      ...violations.map(({ id, impact, nodes }) => ({
        colorScheme,
        id,
        impact,
        targets: nodes.map(node => node.target.join(' '))
      }))
    )
  }
  return found
}

test('the first visit meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/')
  expect(await violations(page)).toEqual([])
})

for (const path of ['/', '/recordings/', '/compose/', '/compose/mary/', '/toots/', '/profile/']) {
  test(`${path} meets WCAG 2.1 AA`, async ({ page }) => {
    await page.addInitScript(skipWelcome)
    await page.goto(path)
    expect(await violations(page)).toEqual([])
  })
}

test('the pages outside the tabs meet WCAG 2.1 AA', async ({ page, pageErrors }) => {
  pageErrors.expect('the server responded with a status of 404')
  for (const [path, shown] of pagesOutsideTheTabs(page)) {
    await page.goto(path)
    await expect(shown).toBeVisible()
    expect(await violations(page), path).toEqual([])
  }
})

test('with reduced motion, nothing but a spinner moves for longer than a frame', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await expect(page.getByTestId('record-button')).toBeVisible()
  const longestSeconds = await page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('*')]
        .filter(element => !element.classList.contains('animate-spin'))
        .flatMap(element => {
          const style = getComputedStyle(element)
          return [style.transitionDuration, style.animationDuration]
            .flatMap(durations => durations.split(','))
            .map(duration => Number.parseFloat(duration))
        })
    )
  )
  expect(longestSeconds).toBeLessThanOrEqual(0.001)
})
