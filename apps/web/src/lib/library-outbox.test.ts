import { describe, expect, it } from 'vitest'
import {
  anotherBrowsersRecording,
  claimedBy,
  libraryHarness,
  newToot,
  openOlderLibrary,
  recordingFields,
  wav
} from '@/test-support/library-page'

const library = libraryHarness()
const { recorded, outbox } = library

describe('the outbox', () => {
  it('queues each save, rename and delete with the change itself', async () => {
    const recording = await recorded()
    const saved = newToot()
    await library.page.toots.saveToot(saved, wav(9))
    expect((await outbox()).map(e => [e.kind, e.op])).toEqual(
      expect.arrayContaining([
        ['recordings', 'put'],
        ['toots', 'put']
      ])
    )
    await library.page.toots.renameToot(saved.id, 'Renamed')
    await library.page.store.deleteRecording(recording.id)
    expect(await outbox()).toEqual([expect.objectContaining({ id: saved.id, op: 'put' })])
  })

  it('queues every Recording and Toot a browser kept before version 3, oldest first', async () => {
    const recording = { ...anotherBrowsersRecording(1), createdAt: 2_000 }
    const older = { ...newToot(), createdAt: 1_000 }
    await openOlderLibrary(2, database => {
      database.createObjectStore('recordings', { keyPath: 'id' }).put(recording)
      database.createObjectStore('audio').put(wav(1), recording.id)
      database.createObjectStore('toots', { keyPath: 'id' }).put(older)
      database.createObjectStore('tootAudio').put(wav(2), older.id)
    })
    const queued = (await outbox()).sort((a, b) => a.queuedAt - b.queuedAt)
    expect(queued.map(e => [e.id, e.op])).toEqual([
      [older.id, 'put'],
      [recording.id, 'put']
    ])
    expect(await library.page.store.loadRecordings()).toEqual([recording])
  })

  it('fails a write the store refuses with its queue, and leaves nothing unhandled', async () => {
    const unhandled: unknown[] = []
    const report = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', report)
    type Method = (this: IDBObjectStore, ...args: unknown[]) => IDBRequest
    const prototype = IDBObjectStore.prototype as unknown as Record<string, Method>
    const refuse = (method: 'add' | 'put' | 'delete', store: string) => {
      const original = prototype[method]
      prototype[method] = function (...args) {
        const request = original.apply(this, args)
        if (this.name === store) this.transaction.abort()
        return request
      }
      return () => {
        prototype[method] = original
      }
    }
    try {
      const recording = await recorded()
      const kept = newToot()
      await library.page.toots.saveToot(kept, wav(9))
      const writes = [
        ['put', 'toots', () => library.page.toots.renameToot(kept.id, 'Not kept')],
        ['add', 'tootAudio', () => library.page.toots.saveToot(newToot(), wav(8))],
        ['add', 'audio', () => library.page.store.saveRecording(recordingFields, wav(7))],
        ['delete', 'downloads', () => library.page.store.deleteRecording(recording.id)]
      ] as const
      for (const [method, store, write] of writes) {
        const mend = refuse(method, store)
        await expect(write()).rejects.toThrow()
        mend()
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', report)
    }
    expect(unhandled).toEqual([])
    expect((await library.page.toots.loadToots()).map(t => t.title)).toEqual([
      'Mary Had a Little Lamb'
    ])
    expect(await library.page.store.loadRecordings()).toHaveLength(1)
  })

  it('clears with the library, with what waits to download and the last read', async () => {
    library.account.add('recordings', anotherBrowsersRecording(), wav(5))
    claimedBy('user-a')
    await recorded()
    await library.page.sync.syncOnce('user-a')
    await recorded(2, false)
    await library.page.store.clearLibrary()
    const database = await library.page.store.db()
    for (const name of ['recordings', 'outbox', 'downloads', 'meta'] as const) {
      expect(await database.count(name)).toBe(0)
    }
  })
})
