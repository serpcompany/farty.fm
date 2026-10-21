import { expect, type Page, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 090 is Melodic: its golden Recording Pitch is G3 (+13 cents).
withFakeMicrophone('090__carlosramon__17-pet__186119.wav')

test('recording a Melodic fart shows its note, and it is still there after a reload', async ({
  page
}) => {
  await recordAndSave(page, 1.5)
  await expect(page.getByTestId('result-note')).toHaveText('G3')

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-note')).toHaveText('G3')

  await page.reload()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
})

/** The one stored Recording's analysis, read straight from IndexedDB. */
async function storedAnalysis(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = await new Promise<{ analysis: { state: string; analysis?: object } }[]>(
      (resolve, reject) => {
        const request = db.transaction('recordings').objectStore('recordings').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }
    )
    db.close()
    const analysis = all[0]?.analysis
    return analysis?.state === 'analyzed' ? { ...analysis.analysis } : null
  })
}

test('an analysis stored before the settle time (#116) gets it on the next open', async ({
  page
}) => {
  await recordAndSave(page, 1.5)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const analyzed = await storedAnalysis(page)
  expect(typeof analyzed?.settleSeconds).toBe('number')

  // As an earlier release stored it: the same analysis, with no settle time.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const store = db.transaction('recordings', 'readwrite').objectStore('recordings')
    await new Promise<void>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        const [recording] = request.result
        delete recording.analysis.analysis.settleSeconds
        const put = store.put(recording)
        put.onsuccess = () => resolve()
        put.onerror = () => reject(put.error)
      }
      request.onerror = () => reject(request.error)
    })
    db.close()
  })
  expect(await storedAnalysis(page)).not.toHaveProperty('settleSeconds')

  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
  await expect.poll(() => storedAnalysis(page), { timeout: 20_000 }).toEqual(analyzed)
})
