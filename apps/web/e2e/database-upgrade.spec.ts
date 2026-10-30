import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// A browser that used Farty before Toots has version 1 of the `pedos` database: Recordings and
// their audio only. The app upgrades it to version 5, which adds the Toots (version 2) and the
// sync's outbox (version 3), shuts code from before #268 out of the outbox (version 4), adds the
// Sound Pad's Pads (version 5), keeps every Recording, and queues each one to upload.

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
      audioBytes: ((await get('audio')) as ArrayBuffer | undefined)?.byteLength,
      queued: await new Promise<unknown>((resolve, reject) => {
        const request = db
          .transaction('outbox')
          .objectStore('outbox')
          .get('recordings:before-toots')
        request.onsuccess = () => resolve((request.result as { op?: string } | undefined)?.op)
        request.onerror = () => reject(request.error)
      })
    }
    db.close()
    return result
  })
  expect(stored).toEqual({
    version: 6,
    stores: ['audio', 'downloads', 'meta', 'outbox', 'pads', 'recordings', 'tootAudio', 'toots'],
    recording: 7,
    audioBytes: wav.byteLength,
    queued: 'put'
  })
})

test('asks you to close Farty in your other tabs while one holds the old database open', async ({
  page,
  context
}) => {
  // An older Farty in another tab: version 1 open, and code that never closes it.
  const old = await context.newPage()
  await old.goto('/robots.txt')
  await old.evaluate(async () => {
    localStorage.setItem('pedos.welcomed', '1')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('recordings', { keyPath: 'id' })
        request.result.createObjectStore('audio')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    ;(window as unknown as { old: IDBDatabase }).old = db
  })

  await page.goto('/recordings/')
  const waiting = page.getByText('Close Farty in your other tabs to carry on.')
  await expect(waiting).toBeVisible()
  await expect(page.getByText('No Recordings yet')).toHaveCount(0)

  await old.evaluate(() => (window as unknown as { old: IDBDatabase }).old.close())
  await expect(waiting).toHaveCount(0)
  await expect(page.getByText('No Recordings yet')).toBeVisible()

  // And the other way: a later version opening in another tab isn't kept waiting by this one.
  const blocked = await old.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        let wasBlocked = false
        const request = indexedDB.open('pedos', 7)
        request.onblocked = () => (wasBlocked = true)
        request.onsuccess = () => {
          request.result.close()
          resolve(wasBlocked)
        }
        request.onerror = () => reject(request.error)
      })
  )
  expect(blocked).toBe(false)
})
