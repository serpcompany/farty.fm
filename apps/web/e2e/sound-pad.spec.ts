import { expect, type Page, test } from '@playwright/test'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'

// The Sound Pad (#277), with two Recordings made through the fake microphone: 095 (F2) and 090
// (G3). A probe notes each sound a Pad starts, and the press that started it, so the journey sees
// playback start, raw, and how long after the press.

test.use({ permissions: ['microphone'] })

type Start = { at: number; rate: number; detune: number; seconds: number }
type Probe = { presses: number[]; starts: Start[]; lit: number[] }

/**
 * An init script: notes every press (its event time), every AudioBufferSourceNode started, and
 * every Pad that lights as it plays, however briefly.
 */
function padProbe(): void {
  const probe: Probe = { presses: [], starts: [], lit: [] }
  ;(window as unknown as { padProbe: Probe }).padProbe = probe
  document.addEventListener('pointerdown', event => probe.presses.push(event.timeStamp), true)
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    probe.starts.push({
      at: performance.now(),
      rate: this.playbackRate.value,
      detune: this.detune.value,
      seconds: this.buffer?.duration ?? 0
    })
    return start.apply(this, args)
  }
  new MutationObserver(changes => {
    for (const { target } of changes) {
      const pad = target as HTMLElement
      if (pad.dataset.testid === 'pad' && pad.dataset.playing)
        probe.lit.push(Number(pad.dataset.pad))
    }
  }).observe(document, { attributes: true, attributeFilter: ['data-playing'], subtree: true })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await page.addInitScript(skipWelcome)
  await page.addInitScript(padProbe)
})

const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { padProbe: Probe }).padProbe)
const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { padProbe: Probe }).padProbe
    p.presses.length = 0
    p.starts.length = 0
    p.lit.length = 0
  })

/** Once Record's microphone is open, farts fixture `id` into it and saves the take. */
async function recordAndSave(page: Page, id: string) {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, id)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
}

const pad = (page: Page, n: number) => page.locator(`[data-testid="pad"][data-pad="${n}"]`)

test('the Sound Pad fills with your farts, plays one at a tap, and keeps the Pad you change', async ({
  page
}) => {
  test.setTimeout(120_000)

  // No Recordings yet: the Sound Pad says how to start.
  await page.goto('/compose/pad/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()

  await page.goto('/')
  await recordAndSave(page, '095')
  await expect(page.getByTestId('result-note')).toHaveText('F2')
  await page.getByRole('button', { name: 'Record another' }).click()
  await recordAndSave(page, '090')
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()

  // Compose opens the Sound Pad, inside the Compose tab.
  await page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: 'Compose', exact: true })
    .click()
  await page.getByRole('link', { name: /Sound Pad/ }).click()
  await expect(page).toHaveURL(/\/compose\/pad\/$/)
  await expect(page.getByRole('heading', { name: 'Sound Pad' })).toBeVisible()

  // Filled lowest note first, and each Pad's sound decoded before a tap.
  await expect(page.getByTestId('pad')).toHaveCount(12)
  await expect(pad(page, 1)).toHaveAccessibleName('Pad 1. Recording 1, F2')
  await expect(pad(page, 2)).toHaveAccessibleName('Pad 2. Recording 2, G3')
  await expect(pad(page, 3)).toHaveAccessibleName('Pad 3. Empty. Choose its fart')
  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await expect(pad(page, 2)).toHaveAttribute('data-ready', 'true')

  // Put Recording 2 on Pad 1.
  await page.getByRole('button', { name: 'Edit' }).click()
  await pad(page, 1).click()
  const chooser = page.getByRole('dialog', { name: 'Pad 1' })
  await expect(chooser.getByRole('button', { name: 'Recording 1, F2' })).toHaveAttribute(
    'aria-current',
    'true'
  )
  await chooser.getByRole('button', { name: 'Recording 2, G3' }).click()
  await expect(chooser).toBeHidden()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(pad(page, 1)).toHaveAccessibleName('Pad 1. Recording 2, G3')
  // Only Pad 1 changed; Recording 1, now on no Pad, takes the first empty one.
  await expect(pad(page, 2)).toHaveAccessibleName('Pad 2. Recording 2, G3')
  await expect(pad(page, 3)).toHaveAccessibleName('Pad 3. Recording 1, F2')

  // A tap plays it at once, raw: at its own speed and pitch, for as long as it sounds.
  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await resetProbe(page)
  await pad(page, 1).tap()
  await expect.poll(async () => (await probe(page)).lit).toEqual([1])
  const tapped = await probe(page)
  expect(tapped.starts).toHaveLength(1)
  expect(tapped.starts[0]).toMatchObject({ rate: 1, detune: 0 })
  // 090's fart, trimmed of the silence around it: about half a second.
  expect(tapped.starts[0].seconds).toBeGreaterThan(0.45)
  expect(tapped.starts[0].seconds).toBeLessThan(0.6)
  expect(tapped.starts[0].at - tapped.presses[0]).toBeLessThan(50)
  await expect(pad(page, 1)).not.toHaveAttribute('data-playing')

  // Two fingers at once: both Pads play, over each other.
  await resetProbe(page)
  await touchTogether(page, [pad(page, 1), pad(page, 3)])
  await expect.poll(async () => (await probe(page)).lit.sort()).toEqual([1, 3])
  expect((await probe(page)).starts).toHaveLength(2)
  await expect(page.locator('[data-playing]')).toHaveCount(0)

  // Kept in this browser: a reload shows the same Pads.
  await page.reload()
  await expect(pad(page, 1)).toHaveAccessibleName('Pad 1. Recording 2, G3')
  await expect(pad(page, 2)).toHaveAccessibleName('Pad 2. Recording 2, G3')
  await expect(pad(page, 3)).toHaveAccessibleName('Pad 3. Recording 1, F2')
})

/** Presses each of `pads` with a finger of its own, all in one touch, then lifts them. */
async function touchTogether(page: Page, pads: ReturnType<typeof pad>[]) {
  const touchPoints = []
  for (const [id, locator] of pads.entries()) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('No Pad')
    touchPoints.push({ x: box.x + box.width / 2, y: box.y + box.height / 2, id })
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
