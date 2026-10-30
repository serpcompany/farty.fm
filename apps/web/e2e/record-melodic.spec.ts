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

test('an analysis an older Recording Analysis made runs again on the next open', async ({
  page
}) => {
  await recordAndSave(page, 1.5)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const analyzed = await storedAnalysis(page)
  expect(typeof analyzed?.settleSeconds).toBe('number')
  expect(typeof analyzed?.version).toBe('number')

  // As a release before #208 stored it: the same analysis, with no version (and, before #116,
  // no settle time).
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
        delete recording.analysis.analysis.version
        const put = store.put(recording)
        put.onsuccess = () => resolve()
        put.onerror = () => reject(put.error)
      }
      request.onerror = () => reject(request.error)
    })
    db.close()
  })
  expect(await storedAnalysis(page)).not.toHaveProperty('version')

  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
  await expect.poll(() => storedAnalysis(page), { timeout: 20_000 }).toEqual(analyzed)
})

test('Re-scan finds the note of a fart the open’s upgrade couldn’t read (#282)', async ({
  page
}) => {
  await recordAndSave(page, 1.5)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const analyzed = await storedAnalysis(page)

  // As an older Recording Analysis left fixtures 009 and 080: no note, at version 4.
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
        Object.assign(recording.analysis.analysis, {
          recordingPitchMidi: null,
          shortestNoteSeconds: null,
          settleSeconds: null,
          version: 4
        })
        const put = store.put(recording)
        put.onsuccess = () => resolve()
        put.onerror = () => reject(put.error)
      }
      request.onerror = () => reject(request.error)
    })
    db.close()
    sessionStorage.setItem('e2e.holdAudio', '1')
  })
  // Until Re-scan is tapped, no read of the audio finds it, as for an account Recording not
  // downloaded yet, so the open's upgrade can't run (each try reads this browser's audio, then the
  // download). The tap's own reads find it.
  await page.addInitScript(() => {
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
  })
  await page.reload()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { heldAudioReads: number }).heldAudioReads)
    )
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )

  await page.getByRole('button', { name: 'Re-scan Recording 1' }).click()
  await expect(page.getByTestId('rescan-status')).toHaveText('1 fart now has a note')
  await expect(page.getByTestId('recording-note')).toHaveText('G3')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^1 Melodic Recording across 1 note\s*1 Recording$/
  )
  // Its analysis is current now, so nothing offers Re-scan.
  await expect(page.getByRole('button', { name: /^Re-scan/ })).toHaveCount(0)
  expect(await storedAnalysis(page)).toEqual(analyzed)
})
