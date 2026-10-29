import type { Locator, Page, ViewportSize } from '@playwright/test'
import { expect } from './test'

export function onPhone({ viewport }: { viewport: ViewportSize | null }): boolean {
  return (viewport?.width ?? 0) < 768
}

export function tab(page: Page, label: string): Locator {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

export function hero(page: Page): Locator {
  return page.getByRole('heading', { name: 'Record your farts. Turn them into songs.', level: 1 })
}

export function pagesOutsideTheTabs(page: Page): [string, Locator][] {
  return [
    ['/privacy/', page.getByRole('heading', { name: 'Privacy', level: 1 })],
    ['/support/', page.getByRole('heading', { name: 'Support', level: 1 })],
    ['/nope/', page.getByText('Page not found')]
  ]
}

export function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function animationsFinished(on: Locator): Promise<void> {
  await on.waitFor()
  await on.page().evaluate(async () => {
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame)
    await Promise.all(
      document
        .getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))
    )
  })
}

export async function expectTappable(control: Locator): Promise<void> {
  await animationsFinished(control)
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

export async function expectAtLeast44High(row: Locator): Promise<void> {
  const box = await row.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

export async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate(visibility => {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

export async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const visibility of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
}

type TaskScheduler = {
  postTask(task: () => void, options: { priority: 'background' }): Promise<void>
}

export async function pageSettled(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { scheduler: TaskScheduler }).scheduler.postTask(() => {}, {
      priority: 'background'
    })
  )
}
