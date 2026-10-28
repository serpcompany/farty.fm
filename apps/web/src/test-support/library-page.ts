import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, vi } from 'vitest'
import type { Recording } from '@/lib/recordings'
import type { Toot } from '@/lib/toot'
import { type FakeAccount, fakeAccount } from './fake-account'
import { memoryStorage } from './web-storage'

export async function openLibraryPage() {
  vi.resetModules()
  return {
    sync: await import('@/lib/library-sync'),
    store: await import('@/lib/recording-store'),
    toots: await import('@/lib/toot-store')
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

export function newToot(title = 'Mary Had a Little Lamb'): Toot {
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
