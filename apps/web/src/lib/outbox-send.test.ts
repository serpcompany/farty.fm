import { beforeEach, describe, expect, it } from 'vitest'
import { bytes, claimedBy, libraryHarness, newToot, wav } from '@/test-support/library-page'

const library = libraryHarness()
const { recorded, outbox, requests, refuse } = library

describe('uploading', () => {
  beforeEach(() => claimedBy('user-a'))

  it("uploads Recordings and Toots as they are, naming the library's account", async () => {
    const recording = await recorded(1)
    const saved = newToot()
    await library.page.toots.saveToot(saved, wav(9))
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(bytes(library.account.get('recordings', recording.id)?.wav)).toEqual(bytes(wav(1)))
    expect(bytes(library.account.get('toots', saved.id)?.wav)).toEqual(bytes(wav(9)))
    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: saved.title })
    expect(requests('PUT').map(s => s.library)).toEqual(['user-a', 'user-a'])
  })

  it("never uploads a library that's another account's", async () => {
    claimedBy('user-b')
    await recorded()
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    await library.page.sync.syncOnce('user-a')
    expect(library.account.sent).toEqual([])
  })

  it('stops uploading once the library is claimed by another account', async () => {
    await recorded(1)
    await recorded(2)
    library.account.intercept = sent => {
      if (sent.method === 'PUT') claimedBy('user-b')
      return undefined
    }
    await library.page.sync.uploadBeforeSignOut('user-a')
    expect(requests('PUT')).toHaveLength(1)
  })

  it("waits for a Recording's analysis", async () => {
    const recording = await recorded(1, false)
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(requests('PUT')).toEqual([])
    await library.page.store.saveAnalysis(recording.id, { state: 'notAnalyzed' })
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(0)
  })

  it.each([
    [
      'is unreachable',
      () => {
        library.account.intercept = sent => {
          if (sent.method === 'PUT') throw new TypeError('Failed to fetch')
          return undefined
        }
      }
    ],
    ['answers 401', () => refuse('PUT', 401, 'unauthorized')],
    ['answers 503', () => refuse('PUT', 503, 'unavailable')],
    ['names another account', () => refuse('PUT', 409, 'wrong_account')]
  ])('stops, keeping everything queued, when Farty %s', async (_, fail) => {
    await recorded(1)
    await recorded(2)
    fail()
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(2)
    expect(requests('PUT')).toHaveLength(1)
  })

  it.each([
    ['is offline', () => (library.account.offline = true)],
    ['names another account', () => refuse('GET', 409, 'wrong_account')]
  ])('uploads nothing until it has read the account: not when Farty %s', async (_, fail) => {
    await recorded(1)
    fail()
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    await library.page.sync.syncOnce('user-a')
    expect(requests('PUT')).toEqual([])
    expect(library.account.sent.map(s => s.library)).toEqual(
      library.account.sent.map(() => 'user-a')
    )
  })

  it('names the library’s account in every request', async () => {
    const recording = await recorded(1)
    const saved = newToot()
    await library.page.toots.saveToot(saved, wav(9))
    await library.page.sync.syncOnce('user-a')
    await library.page.toots.renameToot(saved.id, 'Renamed')
    await library.page.store.deleteRecording(recording.id)
    const made = newToot()
    library.account.add('toots', made, wav(6))
    await library.page.sync.syncOnce('user-a')
    await library.page.toots.loadTootAudio(made.id)
    expect(new Set(library.account.sent.map(s => s.method))).toEqual(
      new Set(['GET', 'PUT', 'PATCH', 'DELETE'])
    )
    expect(library.account.sent.some(s => s.path.endsWith('/audio/'))).toBe(true)
    expect(library.account.sent.map(s => s.library)).toEqual(
      library.account.sent.map(() => 'user-a')
    )
  })

  it.each([
    ['rename', 'PATCH'],
    ['delete', 'DELETE']
  ])('stops, keeping it queued, when a %s names another account', async (_, method) => {
    const saved = newToot()
    await library.page.toots.saveToot(saved, wav(9))
    await library.page.sync.syncOnce('user-a')
    if (method === 'PATCH') await library.page.toots.renameToot(saved.id, 'Renamed')
    else await library.page.toots.deleteToot(saved.id)
    refuse(method, 409, 'wrong_account')
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(await outbox()).toEqual([expect.objectContaining({ id: saved.id })])
  })

  it('keeps a refused upload queued, and sends the rest', async () => {
    const first = await recorded(1)
    const second = await recorded(2)
    library.account.intercept = sent =>
      sent.path.includes(first.id)
        ? Response.json({ error: 'limit_reached' }, { status: 409 })
        : undefined
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(library.account.get('recordings', second.id)).toBeDefined()
    expect(await outbox()).toEqual([expect.objectContaining({ id: first.id, op: 'put' })])
  })

  it('keeps a Recording the account has no room for on this device, waiting to upload', async () => {
    const recording = await recorded(1)
    refuse('PUT', 409, 'limit_reached')
    await library.page.sync.syncOnce('user-a')

    expect((await library.page.store.loadRecordings()).map(r => r.id)).toEqual([recording.id])
    expect(await outbox()).toEqual([expect.objectContaining({ id: recording.id, op: 'put' })])
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(1)
  })

  it('deletes here what the account deleted', async () => {
    const recording = await recorded()
    library.account.add('recordings', recording, wav(1))
    library.account.remove('recordings', recording.id)
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(await library.page.store.loadRecordings()).toEqual([])
  })

  it('renames a Toot on the account that was renamed while it uploaded', async () => {
    const saved = newToot('Old')
    await library.page.toots.saveToot(saved, wav(9))
    library.account.intercept = async sent => {
      if (sent.method === 'PUT') await library.page.toots.renameToot(saved.id, 'New')
      return undefined
    }
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: 'New' })
  })

  it('sends the title of a Toot the account already had', async () => {
    const saved = newToot('New')
    library.account.add('toots', { ...saved, title: 'Old' }, wav(9))
    await library.page.toots.saveToot(saved, wav(9))
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: 'New' })
  })

  it('sends the delete of what reached the account, and nothing for what never did', async () => {
    const uploaded = await recorded(1)
    await library.page.sync.uploadBeforeSignOut('user-a')
    const local = await recorded(2, false)
    await library.page.store.deleteRecording(uploaded.id)
    await library.page.store.deleteRecording(local.id)
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(library.account.isDeleted('recordings', uploaded.id)).toBe(true)
    expect(library.account.sent.filter(s => s.path.includes(local.id))).toEqual([])
  })
})
