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

async function recordAndKeepG3(page: Page) {
  await recordG3(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const analyzed = await storedAnalysis(page)
  const [recording] = await all<StoredRecording>(page, 'recordings')
  return { analyzed, recording }
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
  const { analyzed, recording } = await recordAndKeepG3(page)
  expect(typeof analyzed?.settleSeconds).toBe('number')
  expect(typeof analyzed?.version).toBe('number')

  delete recording.analysis.analysis?.settleSeconds
  delete recording.analysis.analysis?.version
  await write(page, [{ store: 'recordings', value: recording }])
  expect(await storedAnalysis(page)).not.toHaveProperty('version')

  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
  await expect.poll(() => storedAnalysis(page), { timeout: 20_000 }).toEqual(analyzed)
})

function holdAudioUntilRescan(): void {
  if (sessionStorage.getItem('e2e.holdAudio') !== '1') return
  sessionStorage.removeItem('e2e.holdAudio')
  const get = IDBObjectStore.prototype.get
  const held = window as unknown as { heldAudioReads: number; audioHeld: boolean }
  held.heldAudioReads = 0
  held.audioHeld = true
  addEventListener(
    'click',
    event => {
      if ((event.target as Element | null)?.closest('button')?.textContent === 'Re-scan')
        held.audioHeld = false
    },
    true
  )
  IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
    if (this.name !== 'audio' || !held.audioHeld) return get.call(this, key)
    held.heldAudioReads++
    return get.call(this, 'held')
  }
}

const analysisVersionThatFoundNoNoteIn009And080 = 4

test('Re-scan finds the note of a fart the open’s upgrade couldn’t read (#282)', async ({
  page
}) => {
  const { analyzed, recording } = await recordAndKeepG3(page)
  Object.assign(recording.analysis.analysis ?? {}, {
    recordingPitchMidi: null,
    shortestNoteSeconds: null,
    settleSeconds: null,
    version: analysisVersionThatFoundNoNoteIn009And080
  })
  await write(page, [{ store: 'recordings', value: recording }])
  await page.evaluate(() => sessionStorage.setItem('e2e.holdAudio', '1'))
  await page.addInitScript(holdAudioUntilRescan)
  await page.reload()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { heldAudioReads: number }).heldAudioReads)
    )
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('recording-note')).toHaveText('No note')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )

  await page.getByRole('button', { name: 'Re-scan Recording 1' }).click()
  await expect(page.getByTestId('rescan-status')).toHaveText('1 fart now has a note')
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^1 Melodic Recording across 1 note\s*1 Recording$/
  )
  await expect(page.getByRole('button', { name: /^Re-scan/ })).toHaveCount(0)
  expect(await storedAnalysis(page)).toEqual(analyzed)
})
