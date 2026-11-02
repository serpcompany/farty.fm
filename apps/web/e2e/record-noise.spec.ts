import { expect, type Page, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

/**
 * A finger's press, drag and lift, as touch events through the DevTools protocol: Chromium turns
 * them into pointer events with `pointerType` "touch", as on a phone. `page.mouse` sends a mouse's.
 */
async function touchDrag(page: Page, from: Point, to: Point, lift: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  await touch('touchStart', [from])
  for (let i = 1; i <= 5; i++) {
    const x = from.x + ((to.x - from.x) * i) / 5
    await touch('touchMove', [{ x, y: from.y + ((to.y - from.y) * i) / 5 }])
  }
  // The test looks before the finger lifts.
  await lift()
  await touch('touchEnd', [])
  await cdp.detach()
}

type Point = { x: number; y: number }

// Fixture 065 is Noise-like: the golden analysis finds no steady pitch.
withFakeMicrophone('065__reino93__fart-7__324626.wav')

test('recording a Noise-like fart says it has no note', async ({ page }) => {
  await recordAndSave(page, 2.5)
  await expect(page.getByTestId('result-no-note')).toHaveText('No note')
  await expect(
    page.getByText('Songs leave it out until you give it a note from the Recordings tab')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  // On the Recordings tab it has no note, and it isn't a Melodic Recording.
  await expect(page.getByTestId('recording-note')).toHaveText('No note')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})

test('a fart the current analysis found no note in offers no Re-scan (#282)', async ({ page }) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('No note')
  // Analysis is deterministic: a Re-scan could only find what this analysis found.
  await expect(page.getByRole('button', { name: /^Re-scan/ })).toHaveCount(0)
})

test('a Noise-like fart is given a note in its review, moved, and left out again (ADR 0015)', async ({
  page
}) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()

  // The pencil opens its review, on "No note", with nothing to go back to.
  await page.getByRole('button', { name: 'Edit Recording 1' }).click()
  const review = page.getByRole('dialog', { name: 'Recording 1' })
  await expect(review.getByTestId('review-note')).toHaveText('No note')
  await expect(review.getByRole('button', { name: 'No note' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(review.getByTestId('review-caption')).toHaveText(
    'No steady note found, so Songs leave it out. Tap a key if you hear one.'
  )
  await review.getByRole('button', { name: 'E3', exact: true }).click()
  await expect(review.getByTestId('review-note')).toHaveText('E3')
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(review).toBeHidden()

  // It counts as a Melodic Recording on E3, and stays on it after a reload.
  const summary = /^1 Melodic Recording across 1 note\s*1 Recording$/
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByTestId('recording-row')).toContainText('Placed by ear')
  await expect(page.getByTestId('pitch-summary')).toHaveText(summary)
  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByTestId('pitch-summary')).toHaveText(summary)

  // Moved an octave down: the review opens on E3, in its octave.
  await page.getByRole('button', { name: 'Edit Recording 1' }).click()
  await expect(review.getByTestId('review-note')).toHaveText('E3')
  await expect(review.getByTestId('review-octave')).toHaveText(/^Octave 3/)
  await review.getByRole('button', { name: 'Octave down' }).click()
  await review.getByRole('button', { name: 'E2', exact: true }).click()
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('E2')

  // "No note": Songs leave it out again.
  await page.getByRole('button', { name: 'Edit Recording 1' }).click()
  await review.getByRole('button', { name: 'No note' }).click()
  await expect(review.getByTestId('review-note')).toHaveText('No note')
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('No note')
  await expect(page.getByTestId('recording-row')).not.toContainText('Placed by ear')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})

test('a Noise-like fart can be trimmed in its review, and the row then plays just that part (ADR 0019)', async ({
  page
}) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()
  const row = page.getByTestId('recording-row')
  const length = page.getByTestId('recording-length')
  const seconds = async () => Number.parseFloat(await length.innerText())
  const whole = await seconds()

  // The row's waveform scrubs: a drag shows the playhead, and letting go plays from there.
  const waveform = row.getByRole('slider', { name: 'Play Recording 1 from a spot' })
  const box = await waveform.boundingBox()
  if (!box) throw new Error('no waveform')
  await page.mouse.move(box.x + 10, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
  await expect(row.getByTestId('playhead')).toBeVisible()
  await page.mouse.up()
  const play = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, No note$/ })
  await expect(play).toHaveAttribute('aria-pressed', 'true')
  await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 })

  // A finger scrubs the same way: across the row, which pans only up and down (`touch-pan-y`).
  const middle = box.y + box.height / 2
  await touchDrag(
    page,
    { x: box.x + 10, y: middle },
    { x: box.x + box.width * 0.6, y: middle },
    async () => {
      await expect(row.getByTestId('playhead')).toBeVisible()
      await expect(play).toHaveAttribute('aria-pressed', 'false')
    }
  )
  await expect(play).toHaveAttribute('aria-pressed', 'true')
  await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 })

  // In its review the handles sit on the fart; the end pulled in half a second keeps a shorter one.
  await page.getByRole('button', { name: 'Edit Recording 1' }).click()
  const review = page.getByRole('dialog', { name: 'Recording 1' })
  const reset = review.getByRole('button', { name: 'Reset to the fart Farty found' })
  await expect(reset).toBeHidden()
  const reviewLength = review.getByTestId('review-length')
  const handlesApart = async () => Number.parseFloat(await reviewLength.innerText())
  const found = await reviewLength.innerText()
  const end = review.getByRole('slider', { name: 'Where the fart ends' })
  for (let i = 0; i < 5; i++) await end.press('Shift+ArrowLeft')
  // Each press moves the handle 0.1 s, to the nearest hundredth.
  await expect.poll(handlesApart).toBeCloseTo(Number.parseFloat(found) - 0.5, 1)
  await expect(reset).toBeVisible()
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(review).toBeHidden()

  await expect(row).toContainText('Trimmed')
  await expect(
    page.getByRole('button', { name: /^Recording 1, \d+\.\d s, No note, trimmed$/ })
  ).toBeVisible()
  await expect.poll(seconds).toBeLessThan(whole - 0.3)
  await page.reload()
  await expect(row).toContainText('Trimmed')

  // Its review opens on the Trim; Reset and Save: the whole fart again.
  await page.getByRole('button', { name: 'Edit Recording 1' }).click()
  await expect.poll(handlesApart).toBeCloseTo(Number.parseFloat(found) - 0.5, 1)
  await reset.click()
  await expect(reviewLength).toHaveText(found)
  await review.getByRole('button', { name: 'Save' }).click()
  await expect(review).toBeHidden()
  await expect(row).not.toContainText('Trimmed')
  await expect.poll(seconds).toBe(whole)
})

test('a Recording’s review is a modal: focus moves in and stays in, Escape is Cancel, focus goes back (#314)', async ({
  page
}) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()
  // By its tag: under the modal, the tabs are hidden from screen readers too.
  const tabs = page.locator('nav[aria-label="Tabs"]')
  const pencil = page.getByRole('button', { name: 'Edit Recording 1' })
  await pencil.focus()
  await page.keyboard.press('Enter')
  const review = page.getByRole('dialog', { name: 'Recording 1' })
  await expect(review).toBeVisible()
  // The tabs wait under it, as for the record flow, from 768px too, where the top bar shows.
  await expect(tabs).toHaveAttribute('inert', '')
  const inReview = () => review.evaluate(el => el.contains(document.activeElement))
  await expect.poll(inReview).toBe(true)
  // Tab goes round its controls, and never reaches the rows or the tabs under it. Going round, it
  // passes a focus guard that sends focus straight back in.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    await expect.poll(inReview, { message: `Tab ${i + 1}`, timeout: 2000 }).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(review).toBeHidden()
  await expect(pencil).toBeFocused()
  await expect(tabs).not.toHaveAttribute('inert', '')

  // Escape, like Cancel, keeps nothing the review changed.
  await page.keyboard.press('Enter')
  await review.getByRole('button', { name: 'E3', exact: true }).click()
  await expect(review.getByTestId('review-note')).toHaveText('E3')
  await page.keyboard.press('Escape')
  await expect(review).toBeHidden()
  await expect(pencil).toBeFocused()
  await expect(page.getByTestId('recording-note')).toHaveText('No note')
})
