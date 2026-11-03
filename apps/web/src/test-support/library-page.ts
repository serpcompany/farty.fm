import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import type { Placement } from '@/lib/recording-store'
import type { Recording } from '@/lib/recordings'
import type { SongToot } from '@/lib/toot'
import { type FakeAccount, fakeAccount } from './fake-account'
import { memoryStorage } from './web-storage'

export async function openLibraryPage() {
  vi.resetModules()
  return {
    sync: await import('@/lib/library-sync'),
    changes: await import('@/lib/library-changes'),
    store: await import('@/lib/recording-store'),
    toots: await import('@/lib/toot-store'),
    favorites: await import('@/lib/favorite-store')
  }
}

export type LibraryPage = Awaited<ReturnType<typeof openLibraryPage>>

export function stubLibraryBrowser(): FakeAccount {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('navigator', {})
  const account = fakeAccount('user-a')
  vi.stubGlobal('fetch', vi.fn(account.fetch))
  return account
}

export const wav = (n: number) => new Uint8Array([82, 73, 70, 70, n, n, n]).buffer

export const bytes = (buffer: ArrayBuffer | null | undefined) => [...new Uint8Array(buffer ?? [])]

export const recordingFields = { seconds: 1, sampleRate: 48_000, waveform: [0.5] }

export async function saveRecordingOn(page: LibraryPage, n = 1, analyzed = true) {
  const recording = await page.store.saveRecording(recordingFields, wav(n))
  if (!analyzed) return recording
  return (await page.store.saveAnalysis(recording.id, { state: 'notAnalyzed' })) as Recording
}

export function newToot(title = 'Mary Had a Little Lamb'): SongToot {
  return {
    id: crypto.randomUUID(),
    title,
    songId: 'mary-had-a-little-lamb',
    createdAt: Date.now(),
    seconds: 3,
    arrangement: { transposition: 0, recordingForPitch: {} }
  }
}

export function anotherBrowsersRecording(n = 2): Recording {
  return {
    id: crypto.randomUUID(),
    number: n,
    createdAt: Date.now(),
    seconds: 1,
    sampleRate: 48_000,
    waveform: [0.25],
    analysis: { state: 'notAnalyzed' }
  }
}

export const claimedBy = (id: string) => localStorage.setItem('pedos.account', id)

export function openOlderLibrary(
  version: number,
  create: (database: IDBDatabase, transaction: IDBTransaction) => void,
  keepOpen = false
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('pedos', version)
    open.onupgradeneeded = () => create(open.result, open.transaction as IDBTransaction)
    open.onsuccess = () => {
      if (!keepOpen) open.result.close()
      resolve(open.result)
    }
    open.onerror = () => reject(open.error)
  })
}

export function libraryHarness() {
  const harness = {
    account: fakeAccount(),
    page: undefined as unknown as LibraryPage,
    recorded: (n = 1, analyzed = true) => saveRecordingOn(harness.page, n, analyzed),
    outbox: async () => (await harness.page.store.db()).getAll('outbox'),
    requests: (method: string) => harness.account.sent.filter(s => s.method === method),
    refuse: (method: string, status: number, error: string) => {
      harness.account.intercept = sent =>
        sent.method === method ? Response.json({ error }, { status }) : undefined
    },
    placedWhileUploading: async (change: Placement) => {
      const recording = await harness.recorded(1)
      harness.account.intercept = async sent => {
        if (sent.method === 'PUT') await harness.page.store.placeRecording(recording.id, change)
        return undefined
      }
      expect((await harness.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
      expect(harness.account.get('recordings', recording.id)?.item).toMatchObject(change)
      expect(await harness.outbox()).toEqual([])
    },
    sendsAlone: async (id: string, change: Placement, kept: Placement) => {
      await harness.page.sync.syncOnce('user-a')
      expect(harness.requests('PATCH').map(s => s.json)).toEqual([change])
      expect(harness.account.get('recordings', id)?.item).toMatchObject(kept)
      await harness.page.sync.syncOnce('user-a')
      expect((await harness.page.store.loadRecordings())[0]).toMatchObject(kept)
    },
    keptWhileSending: async (recording: Recording, mine: Placement, theirs: Placement) => {
      harness.refuse('PATCH', 503, 'unavailable')
      await harness.page.store.placeRecording(recording.id, mine)
      harness.account.placeAndTrim(recording.id, theirs)
      await harness.page.sync.syncOnce('user-a')
      expect((await harness.page.store.loadRecordings())[0]).toEqual(expect.objectContaining(mine))
      harness.account.intercept = null
      await harness.page.sync.syncOnce('user-a')
      harness.account.add('recordings', recording, wav(5))
      await harness.page.sync.syncOnce('user-a')
      expect((await harness.page.store.loadRecordings())[0]).toEqual(expect.objectContaining(mine))
    }
  }
  beforeEach(async () => {
    harness.account = stubLibraryBrowser()
    harness.page = await openLibraryPage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  return harness
}
