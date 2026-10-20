import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// A browser that used Pedos before Toots has version 1 of the `pedos` database: Recordings and
// their audio only. The app upgrades it to version 2, which adds the Toots, and keeps every
// Recording.

test('upgrades a database from before Toots and keeps its Recordings', async ({ page }) => {
  const wav = readFileSync(
    resolve(__dirname, '../../../fixtures/recordings', '090__carlosramon__17-pet__186119.wav')
  )

  // Version 1, as the app made it, on a page of the site that doesn't open the database.
  await page.goto('/robots.txt')
  await page.evaluate(async base64 => {
    localStorage.setItem('pedos.welcomed', '1')
    const audio = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('recordings', { keyPath: 'id' })
        request.result.createObjectStore('audio')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction(['recordings', 'audio'], 'readwrite')
    transaction.objectStore('recordings').put({
      id: 'before-toots',
      number: 7,
      createdAt: Date.now(),
      seconds: 0.5,
      sampleRate: 44100,
      waveform: [],
      analysis: { state: 'notAnalyzed' }
    })
    transaction.objectStore('audio').put(audio, 'before-toots')
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, wav.toString('base64'))

  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-row')).toContainText('Recording 7')

  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const get = (store: string) =>
      new Promise<unknown>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get('before-toots')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const result = {
      version: db.version,
      stores: [...db.objectStoreNames].sort(),
      recording: ((await get('recordings')) as { number: number } | undefined)?.number,
      audioBytes: ((await get('audio')) as ArrayBuffer | undefined)?.byteLength
    }
    db.close()
    return result
  })
  expect(stored).toEqual({
    version: 2,
    stores: ['audio', 'recordings', 'tootAudio', 'toots'],
    recording: 7,
    audioBytes: wav.byteLength
  })
})
