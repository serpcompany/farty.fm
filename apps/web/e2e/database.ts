import type { Page } from '@playwright/test'
import { expect } from './test'

type Read = {
  store: string
  key?: string
  method: 'count' | 'getAll' | 'getAllKeys' | 'get' | 'layout'
}

type Write = { store: string; value?: unknown; bytes?: string; key?: string }

type Layout = { version?: number; stores?: Record<string, string | null>; keepOpen?: boolean }

async function read<T>(page: Page, query: Read): Promise<T> {
  const result = await page.evaluate<unknown, Read>(async ({ store, key, method }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (method === 'layout') return { version: db.version, stores: [...db.objectStoreNames] }
      if (!db.objectStoreNames.contains(store)) return method === 'count' ? 0 : undefined
      const objects = db.transaction(store).objectStore(store)
      const request =
        method === 'get' && key !== undefined ? objects.get(key) : objects[method as 'count']()
      const result = await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (!(result instanceof ArrayBuffer)) return result
      return new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.readAsDataURL(new Blob([result]))
      })
    } finally {
      db.close()
    }
  }, query)
  return result as T
}

export async function layout(page: Page): Promise<{ version: number; stores: string[] }> {
  const { version, stores } = await read<{ version: number; stores: string[] }>(page, {
    store: '',
    method: 'layout'
  })
  return { version, stores: stores.sort() }
}

export function stored(page: Page, store: string): Promise<number> {
  return read(page, { store, method: 'count' })
}

export function all<T>(page: Page, store: string): Promise<T[]> {
  return read(page, { store, method: 'getAll' })
}

export async function keys(page: Page, store: string): Promise<string[]> {
  return (await read<string[]>(page, { store, method: 'getAllKeys' })).map(String)
}

export function entry<T>(page: Page, store: string, key: string): Promise<T | undefined> {
  return read(page, { store, key, method: 'get' })
}

export async function bytes(page: Page, store: string, key: string): Promise<Buffer | null> {
  const base64 = await read<string | undefined>(page, { store, key, method: 'get' })
  return base64 === undefined ? null : Buffer.from(base64, 'base64')
}

export function write(page: Page, writes: Write[], layout: Layout = {}): Promise<void> {
  return page.evaluate<void, { writes: Write[]; layout: Layout }>(
    async ({ writes, layout }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('pedos', layout.version)
        request.onupgradeneeded = () => {
          for (const [name, keyPath] of Object.entries(layout.stores ?? {})) {
            request.result.createObjectStore(name, keyPath ? { keyPath } : undefined)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (writes.length > 0) {
        const transaction = db.transaction([...new Set(writes.map(w => w.store))], 'readwrite')
        for (const { store, value, bytes, key } of writes) {
          const objects = transaction.objectStore(store)
          if (value === undefined && bytes === undefined && key !== undefined) objects.delete(key)
          else if (bytes === undefined) objects.put(value, key)
          else objects.put(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)).buffer, key)
        }
        await new Promise((resolve, reject) => {
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error)
        })
      }
      if (layout.keepOpen) Object.assign(window, { pedosKeptDatabase: db })
      else db.close()
    },
    { writes, layout }
  )
}

export function closeKeptDatabase(page: Page): Promise<void> {
  return page.evaluate(() =>
    (window as unknown as { pedosKeptDatabase: IDBDatabase }).pedosKeptDatabase.close()
  )
}

export async function uploaded(page: Page): Promise<void> {
  await expect.poll(() => stored(page, 'outbox'), { timeout: 60_000 }).toBe(0)
}

export function standInForPersist(): void {
  const documentWithoutStorage = window.origin === 'null'
  if (documentWithoutStorage) return
  const asked = window as unknown as { persistAsked: boolean }
  asked.persistAsked = false
  navigator.storage.persisted = async () => false
  navigator.storage.persist = async () => {
    asked.persistAsked = true
    return true
  }
}

export function persistAsked(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { persistAsked: boolean }).persistAsked)
}
