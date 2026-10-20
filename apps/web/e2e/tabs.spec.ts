import { expect, type Page, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 090 is Melodic: its golden Recording Pitch is G3 (+13 cents).
withFakeMicrophone('090__carlosramon__17-pet__186119.wav')

// `next dev` puts its Dev Tools button over the Recordings tab at phone size.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { display: none !important; }'
      document.head.append(style)
    })
  })
})

/** Counts every sound stopped before its end, which a sound that plays out never is. */
async function countStops(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counter = window as unknown as { pedosStops: number }
    counter.pedosStops = 0
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (when?: number) {
      counter.pedosStops += 1
      stop.call(this, when)
    }
  })
}

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

function stops(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { pedosStops: number }).pedosStops)
}

/** Fakes the page going to the background (`hidden`) and coming back (`visible`). */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

test('the app opens on Record, and every tab works before the first Recording', async ({
  page
}) => {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/')
  const tabs = page.getByRole('navigation', { name: 'Tabs' }).getByRole('link')
  await expect(tabs).toHaveText(['Recordings', 'Compose', 'Record', 'Toots', 'Profile'])
  await expect(tabs.nth(2)).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('record-button')).toBeVisible()

  const screens = [
    ['Recordings', /\/recordings\/$/, 'Go to the Record tab and tap the red button.'],
    ['Compose', /\/compose\/$/, 'Record a few farts with a clear note to start unlocking Songs.'],
    ['Record', /:\d+\/$/, null],
    ['Toots', /\/toots\/$/, 'Make one in Compose.'],
    [
      'Profile',
      /\/profile\/$/,
      'Record your first fart on the Record tab. Collect notes to unlock Songs.'
    ]
  ] as const
  for (const [label, url, text] of screens) {
    await tab(page, label).click()
    await expect(page).toHaveURL(url)
    await expect(tab(page, label)).toHaveAttribute('aria-current', 'page')
    if (text) await expect(page.getByText(text)).toBeVisible()
    else await expect(page.getByTestId('record-button')).toBeVisible()
  }
})

test('a Recording shows on the Recordings tab with its note, and playback stops on a tab change', async ({
  page
}) => {
  await countStops(page)
  await recordAndSave(page, 1.5)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page).toHaveURL(/\/recordings\/$/)
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^1 Melodic Recording across 1 note\s*1 Recording$/
  )
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-note')).toHaveText('G3')

  const row = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G3$/ })
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await tab(page, 'Compose').click()
  await expect.poll(() => stops(page)).toBe(1)

  await tab(page, 'Recordings').click()
  await expect(row).toHaveAttribute('aria-pressed', 'false')

  // The page goes to the background: playback stops, and the page comes back on Record.
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await setVisibility(page, 'hidden')
  await expect.poll(() => stops(page)).toBe(2)
  await expect(row).toHaveAttribute('aria-pressed', 'false')
  await expect(page).toHaveURL(/\/recordings\/$/)
  await setVisibility(page, 'visible')
  await expect(page).toHaveURL(/:\d+\/$/)
  await expect(tab(page, 'Record')).toHaveAttribute('aria-current', 'page')
})
