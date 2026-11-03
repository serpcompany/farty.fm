import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { all, bytes } from './database'
import { payAtTheDevCheckout } from './pay'
import { fartAndSave, withFartingMicrophone } from './record'
import { tab } from './screens'
import { expect, test } from './test'

withFartingMicrophone()

type Start = { at: number; rate: number; detune: number; seconds: number; peak: number }
type Probe = { presses: number[]; starts: Start[]; lit: number[] }

function fartyPadProbe(): void {
  const probe: Probe = { presses: [], starts: [], lit: [] }
  ;(window as unknown as { fartyPadProbe: Probe }).fartyPadProbe = probe
  document.addEventListener('pointerdown', event => probe.presses.push(event.timeStamp), true)
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    const at = performance.now()
    let peak = 0
    for (let c = 0; c < (this.buffer?.numberOfChannels ?? 0); c++) {
      for (const s of this.buffer?.getChannelData(c) ?? []) peak = Math.max(peak, Math.abs(s))
    }
    probe.starts.push({
      at,
      rate: this.playbackRate.value,
      detune: this.detune.value,
      seconds: this.buffer?.duration ?? 0,
      peak
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
  await page.addInitScript(fartyPadProbe)
})

const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { fartyPadProbe: Probe }).fartyPadProbe)
const resetProbe = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { fartyPadProbe: Probe }).fartyPadProbe
    p.presses.length = 0
    p.starts.length = 0
    p.lit.length = 0
  })

const pad = (page: Page, n: number) => page.locator(`[data-testid="pad"][data-pad="${n}"]`)

test('the Sound Pad fills with your farts, plays one at a tap, and keeps the Pad you change', async ({
  page
}) => {
  test.setTimeout(120_000)

  await page.goto('/compose/pad/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()

  await page.goto('/')
  await fartAndSave(page, '095')
  await expect(page.getByTestId('result-note')).toHaveText('F2')
  await page.getByRole('button', { name: 'Record another' }).click()
  await fartAndSave(page, '090')
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()

  await tab(page, 'Compose').click()
  await page.getByRole('link', { name: /Sound Pad/ }).click()
  await expect(page).toHaveURL(/\/compose\/pad\/$/)
  await expect(page.getByRole('heading', { name: 'Sound Pad' })).toBeVisible()

  await expect(page.getByTestId('pad')).toHaveCount(12)
  await expect(pad(page, 1)).toHaveAccessibleName('Pad 1. F2, Recording 1')
  await expect(pad(page, 2)).toHaveAccessibleName('Pad 2. G3, Recording 2')
  await expect(pad(page, 3)).toHaveAccessibleName('Pad 3. Empty. Choose its fart')
  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await expect(pad(page, 2)).toHaveAttribute('data-ready', 'true')

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
  await expect(pad(page, 1)).toHaveAccessibleName('Pad 1. G3, Recording 2')
  await expect(pad(page, 2)).toHaveAccessibleName('Pad 2. G3, Recording 2')
  await expect(pad(page, 3)).toHaveAccessibleName('Pad 3. F2, Recording 1')

  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await resetProbe(page)
  await pad(page, 1).tap()
  await expect.poll(async () => (await probe(page)).lit).toEqual([1])
  const tapped = await probe(page)
  expect(tapped.starts).toHaveLength(1)
  expect(tapped.starts[0]).toMatchObject({ rate: 1, detune: 0 })
  expect(tapped.starts[0].peak).toBeCloseTo(0.5, 5)
  expect(tapped.starts[0].seconds).toBeGreaterThan(0.45)
  expect(tapped.starts[0].seconds).toBeLessThan(0.6)
  expect(tapped.starts[0].at - tapped.presses[0]).toBeLessThan(50)
  await expect(pad(page, 1)).not.toHaveAttribute('data-playing')

  await resetProbe(page)
  await touchTogether(page, [pad(page, 1), pad(page, 3)])
  await expect.poll(async () => (await probe(page)).lit.sort()).toEqual([1, 3])
  const together = (await probe(page)).starts
  expect(together).toHaveLength(2)
  for (const started of together) expect(started.peak).toBeCloseTo(0.5, 5)
  await expect(page.locator('[data-playing]')).toHaveCount(0)

  await page.reload()
  await expect(pad(page, 1)).toHaveAccessibleName('Pad 1. G3, Recording 2')
  await expect(pad(page, 2)).toHaveAccessibleName('Pad 2. G3, Recording 2')
  await expect(pad(page, 3)).toHaveAccessibleName('Pad 3. F2, Recording 1')
})

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null

type Kept = {
  id: string
  songId: string | null
  title: string
  seconds: number
  performance: { recordings: string[]; taps: [number, number][] }
}

test('records a take on the Pads, plays it back, and saves it as a Toot for $0.99', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })

  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'pad-take'))
  await page.goto('/')
  await fartAndSave(page, '095')
  await page.getByRole('button', { name: 'Record another' }).click()
  await fartAndSave(page, '090')
  await page.getByRole('button', { name: 'Done' }).click()

  await page.goto('/compose/pad/')
  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await expect(pad(page, 2)).toHaveAttribute('data-ready', 'true')
  const state = page.getByTestId('pad-take-state')
  await expect(state).toHaveText('Record')
  if (out) await page.screenshot({ path: join(out, 'pad-idle.png') })

  await page.getByTestId('pad-take-record').tap()
  await expect(state).toHaveText('Recording')
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await resetProbe(page)
  for (const [i, n] of [1, 2, 1, 2, 1].entries()) {
    await pad(page, n).tap()
    await expect.poll(async () => (await probe(page)).lit.length).toBe(i + 1)
    await expect(page.locator('[data-playing]')).toHaveCount(0)
  }
  await expect(state).toHaveText(/^0:0\d of 0:30$/)
  if (out) await page.screenshot({ path: join(out, 'pad-recording.png') })
  const taken = await probe(page)
  const presses = taken.presses
  expect(presses).toHaveLength(5)
  expect(taken.starts).toHaveLength(5)
  const length = Math.max(
    ...taken.starts.map((s, i) => (presses[i] - presses[0]) / 1000 + s.seconds)
  )
  await page.getByTestId('pad-take-stop').tap()

  const toot = page.getByTestId('pad-toot-state')
  await expect(toot).toHaveText('Playing', { timeout: 60_000 })
  const whole = (await probe(page)).starts.at(-1)
  expect(whole).toMatchObject({ rate: 1, detune: 0 })
  expect(Math.abs((whole?.seconds ?? 0) - length)).toBeLessThan(0.01)
  await expect(page.getByText('5 taps of 2 Recordings')).toBeVisible()
  if (out) await page.screenshot({ path: join(out, 'pad-made.png') })
  await expect(toot).toHaveText('Ready', { timeout: 15_000 })

  const save = page.getByRole('button', { name: 'Save to Toots · $0.99' })
  await expect(save).toBeVisible()
  await save.click()
  await payAtTheDevCheckout(page, 'pad')
  await expect(page.getByTestId('pad-toot-state')).toHaveText('Ready')
  if (out) await page.screenshot({ path: join(out, 'pad-saved.png') })

  const [kept] = await toots(page)
  expect(kept).toMatchObject({ songId: null, title: 'Sound Pad' })
  expect(kept.performance.taps.map(([, recording]) => recording)).toEqual([0, 1, 0, 1, 0])
  kept.performance.taps.forEach(([at], i) => {
    expect(Math.abs(at - (presses[i] - presses[0]) / 1000)).toBeLessThanOrEqual(0.0005 + 1e-9)
  })
  expect(kept.seconds).toBeCloseTo(whole?.seconds ?? 0, 3)
  if (out) {
    const sounds = taken.starts.map(s => s.seconds)
    writeFileSync(join(out, 'pad-toot.json'), JSON.stringify({ presses, sounds, kept }, null, 2))
    writeFileSync(join(out, 'pad-toot.wav'), await storedWav(page, 'tootAudio', kept.id))
    for (const [i, id] of kept.performance.recordings.entries()) {
      writeFileSync(join(out, `pad-recording-${i}.wav`), await storedWav(page, 'audio', id))
    }
  }

  await tab(page, 'Toots').click()
  const row = page.getByTestId('toot-row')
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('toot-details')).toHaveText(/^Sound Pad · .+ · 0:0\d$/)
  if (out) await page.screenshot({ path: join(out, 'toots.png') })
  await row.getByRole('link').click()
  await expect(page).toHaveURL(/\/toots\/toot\/\?id=/)
  await resetProbe(page)
  await page.getByTestId('pad-toot-play').click()
  await expect(page.getByTestId('pad-toot-state')).toHaveText('Playing')
  await expect.poll(async () => (await probe(page)).starts.length).toBe(1)
  expect((await probe(page)).starts[0].seconds).toBeCloseTo(whole?.seconds ?? 0, 3)
  if (out) await page.screenshot({ path: join(out, 'pad-toot-screen.png') })
})

test('saves a paid take on the next open when the return from Checkout never loaded, paying once', async ({
  page
}, testInfo) => {
  test.setTimeout(150_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'pad-take-unreturned'))
  await page.goto('/')
  await fartAndSave(page, '095')
  await page.getByRole('button', { name: 'Done' }).click()

  await page.goto('/compose/pad/')
  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await page.getByTestId('pad-take-record').tap()
  await pad(page, 1).tap()
  await page.getByTestId('pad-take-stop').tap()
  await expect(page.getByTestId('pad-toot-state')).toHaveText('Ready', { timeout: 60_000 })

  const checkouts: string[] = []
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if (request.method() !== 'POST') return
    if (/^\/api\/toots\/[\w-]+\/checkout\/$/.test(pathname) || pathname === '/api/dev/checkout/')
      checkouts.push(pathname)
  })
  let paidReturn = ''
  await page.route('**/api/dev/checkout/', async route => {
    const paid = await route.fetch({ maxRedirects: 0 })
    expect(paid.status()).toBe(303)
    paidReturn = paid.headers().location ?? ''
    await route.fulfill({ contentType: 'text/html', body: '<p>Closed at Checkout</p>' })
  })
  await page.getByRole('button', { name: 'Save to Toots · $0.99' }).click()
  await expect(page).toHaveURL(/\/dev\/checkout\/\?toot=[\w-]+$/)
  const tootId = new URL(page.url()).searchParams.get('toot')
  await page.getByRole('button', { name: 'Pay $0.99' }).click()
  await expect(page.getByText('Closed at Checkout')).toBeVisible()
  expect(paidReturn).toContain(`/compose/pad/?toot=${tootId}&checkout=done`)
  await page.unroute('**/api/dev/checkout/')
  expect(await toots(page)).toEqual([])

  await page.goto('/compose/pad/')
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled({
    timeout: 60_000
  })
  const saved = await toots(page)
  expect(saved.map(toot => toot.id)).toEqual([tootId])
  expect(saved[0]).toMatchObject({ songId: null, title: 'Sound Pad' })
  expect(await page.evaluate(() => localStorage.getItem('pedos.padTakes'))).toBeNull()

  await page.goto('/compose/pad/')
  await expect(pad(page, 1)).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('pad-take-state')).toHaveText('Record')
  expect((await toots(page)).map(toot => toot.id)).toEqual([tootId])
  expect(checkouts).toEqual([`/api/toots/${tootId}/checkout/`, '/api/dev/checkout/'])
})

function toots(page: Page): Promise<Kept[]> {
  return all<Kept>(page, 'toots')
}

async function storedWav(page: Page, store: 'tootAudio' | 'audio', id: string): Promise<Buffer> {
  const wav = await bytes(page, store, id)
  if (!wav) throw new Error(`No ${store} for ${id}`)
  return wav
}

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
