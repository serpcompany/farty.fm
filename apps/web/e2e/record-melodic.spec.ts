import type { Page } from '@playwright/test'
import { all, write } from './database'
import { recordG3, withFartingMicrophone } from './record'
import { expect, test } from './test'

withFartingMicrophone()

type StoredRecording = { analysis: { state: string; analysis?: Record<string, unknown> } }

async function storedAnalysis(page: Page): Promise<Record<string, unknown> | null> {
  const [recording] = await all<StoredRecording>(page, 'recordings')
  const { state, analysis } = recording?.analysis ?? {}
  return state === 'analyzed' ? { ...analysis } : null
}

test('recording a Melodic fart shows its note, and it is still there after a reload', async ({
  page
}) => {
  await recordG3(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-note')).toHaveText('G3')

  await page.reload()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
})

test('an analysis an older Recording Analysis made runs again on the next open', async ({
  page
}) => {
  await recordG3(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const analyzed = await storedAnalysis(page)
  expect(typeof analyzed?.settleSeconds).toBe('number')
  expect(typeof analyzed?.version).toBe('number')

  const [recording] = await all<StoredRecording>(page, 'recordings')
  delete recording.analysis.analysis?.settleSeconds
  delete recording.analysis.analysis?.version
  await write(page, [{ store: 'recordings', value: recording }])
  expect(await storedAnalysis(page)).not.toHaveProperty('version')

  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
  await expect.poll(() => storedAnalysis(page), { timeout: 20_000 }).toEqual(analyzed)
})
