import { expect, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 084 holds two farts: the golden analysis reads its pitch from the first, G♯3 (-17
// cents), and keeps both, 1.97 s against the first burst's 0.64 s (ADR 0016).
withFakeMicrophone('084__walter-odington__grim-fart__26216.wav')

type Replay = { offset?: number; duration?: number; length: number }

/** An init script: notes each sound the page starts, with its offset, duration and length. */
function noteReplays(): void {
  const replays: Replay[] = []
  Object.assign(window, { replays })
  const start = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    replays.push({ offset, duration, length: this.buffer?.duration ?? 0 })
    return start.call(this, when, offset, duration)
  }
}

const replays = () => (window as unknown as { replays: Replay[] }).replays

test('recording two farts keeps both, and replay plays the whole take', async ({ page }) => {
  await page.addInitScript(noteReplays)
  await recordAndSave(page, 3.5)
  await expect(page.getByTestId('result-note')).toHaveText('G♯3')
  await expect(page.getByText('We kept the first fart')).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByTestId('recording-note')).toHaveText('G♯3')
  await expect(page.getByTestId('recording-row')).not.toContainText('First fart used')
  const row = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G♯3$/ })
  await expect(row).toBeVisible()
  // Both bursts count: far longer than the first burst's 0.6 s.
  const length = Number.parseFloat(await page.getByTestId('recording-length').innerText())
  expect(length).toBeGreaterThanOrEqual(1.5)

  const before = (await page.evaluate(replays)).length
  await row.click()
  await expect.poll(async () => (await page.evaluate(replays)).length).toBe(before + 1)
  const replay = (await page.evaluate(replays)).at(-1)
  // No offset and no duration: the whole take, about the 3.5 s recorded, start to end.
  expect(replay?.offset).toBeUndefined()
  expect(replay?.duration).toBeUndefined()
  expect(replay?.length).toBeGreaterThan(3)
})
