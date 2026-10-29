import { beforeEach, describe, expect, it } from 'vitest'
import type { Kind, OutboxOp } from '@/lib/outbox'
import {
  anotherBrowsersRecording,
  bytes,
  claimedBy,
  libraryHarness,
  newToot,
  openLibraryPage,
  wav
} from '@/test-support/library-page'

const library = libraryHarness()
const { recorded, outbox, requests, refuse } = library

describe('uploading', () => {
  beforeEach(() => claimedBy('user-a'))

  it("uploads Recordings and Toots as they are, naming the library's account", async () => {
    const recording = await recorded(1)
    const saved = newToot()
    await library.page.toots.saveToot(saved, wav(9))
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(bytes(library.account.get('recordings', recording.id)?.wav)).toEqual(bytes(wav(1)))
    expect(bytes(library.account.get('toots', saved.id)?.wav)).toEqual(bytes(wav(9)))
    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: saved.title })
    expect(requests('PUT').map(s => s.library)).toEqual(['user-a', 'user-a'])
  })

  it("never uploads a library that's another account's", async () => {
    claimedBy('user-b')
    await recorded()
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
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
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
    expect(requests('PUT')).toEqual([])
    await library.page.store.saveAnalysis(recording.id, { state: 'notAnalyzed' })
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
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
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(2)
    expect(requests('PUT')).toHaveLength(1)
  })

  it.each([
    ['is offline', () => (library.account.offline = true)],
    ['names another account', () => refuse('GET', 409, 'wrong_account')]
  ])('uploads nothing until it has read the account: not when Farty %s', async (_, fail) => {
    await recorded(1)
    fail()
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
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
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
    expect(await outbox()).toEqual([expect.objectContaining({ id: saved.id })])
  })

  it('keeps a refused upload queued, and sends the rest', async () => {
    const first = await recorded(1)
    const second = await recorded(2)
    library.account.intercept = sent =>
      sent.path.includes(first.id)
        ? Response.json({ error: 'too_large' }, { status: 413 })
        : undefined
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
    expect(library.account.get('recordings', second.id)).toBeDefined()
    expect(await outbox()).toEqual([expect.objectContaining({ id: first.id, op: 'put' })])
  })

  it('keeps a Recording the account has no room for on this device, waiting to upload', async () => {
    const recording = await recorded(1)
    refuse('PUT', 409, 'limit_reached')
    await library.page.sync.syncOnce('user-a')

    expect((await library.page.store.loadRecordings()).map(r => r.id)).toEqual([recording.id])
    expect(await outbox()).toEqual([expect.objectContaining({ id: recording.id, op: 'put' })])
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
  })

  it('deletes here what the account deleted', async () => {
    const recording = await recorded()
    library.account.add('recordings', recording, wav(1))
    library.account.remove('recordings', recording.id)
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(await library.page.store.loadRecordings()).toEqual([])
  })

  it('renames a Toot on the account that was renamed while it uploaded', async () => {
    const saved = newToot('Old')
    await library.page.toots.saveToot(saved, wav(9))
    library.account.intercept = async sent => {
      if (sent.method === 'PUT') await library.page.toots.renameToot(saved.id, 'New')
      return undefined
    }
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: 'New' })
  })

  it('sends the title of a Toot the account already had', async () => {
    const saved = newToot('New')
    library.account.add('toots', { ...saved, title: 'Old' }, wav(9))
    await library.page.toots.saveToot(saved, wav(9))
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: 'New' })
  })

  it('places a Recording on the account, in its upload or after it (ADR 0015)', async () => {
    const early = await recorded(1)
    await library.page.store.placeRecording(early.id, 40)
    expect(await outbox()).toEqual([expect.objectContaining({ id: early.id, op: 'put' })])
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', early.id)?.item).toMatchObject({ placedPitch: 40 })
    expect(requests('PATCH')).toEqual([])
    await library.page.store.placeRecording(early.id, 41)
    await library.page.store.placeRecording(early.id, null)
    expect((await outbox()).map(e => e.op)).toEqual(['place'])
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', early.id)?.item).toMatchObject({ placedPitch: null })
    expect(requests('PATCH').map(s => [s.path, s.library])).toEqual([
      [`/api/recordings/${early.id}/`, 'user-a']
    ])
  })

  it('places a Recording on the account that was placed while it uploaded', async () => {
    const recording = await recorded(1)
    library.account.intercept = async sent => {
      if (sent.method === 'PUT') await library.page.store.placeRecording(recording.id, 52)
      return undefined
    }
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', recording.id)?.item).toMatchObject({
      placedPitch: 52
    })
    expect(await outbox()).toEqual([])
  })

  it('sends the Placed Pitch of a Recording the account already had, from an upload cut off before it was placed', async () => {
    const recording = await recorded(1)
    await library.page.store.placeRecording(recording.id, 45)
    library.account.add('recordings', { ...recording, placedPitch: null }, wav(1))
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', recording.id)?.item).toMatchObject({
      placedPitch: 45
    })
  })

  it('forgets a place the account refuses, and deletes here what it deleted', async () => {
    const refused = await recorded(1)
    const gone = await recorded(2)
    await library.page.sync.uploadBeforeSignOut('user-a')
    await library.page.store.placeRecording(refused.id, 40)
    await library.page.store.placeRecording(gone.id, 40)
    library.account.remove('recordings', gone.id)
    library.account.intercept = sent =>
      sent.method === 'PATCH' && sent.path.includes(refused.id)
        ? Response.json({ error: 'invalid_request' }, { status: 400 })
        : undefined
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(await outbox()).toEqual([])
    expect((await library.page.store.loadRecordings()).map(r => r.id)).toEqual([refused.id])
  })

  it('never sends an op from a later build that it doesn’t know, and keeps it queued, as code from before #268 sent a place as a delete', async () => {
    const recording = await recorded(1)
    await library.page.sync.uploadBeforeSignOut('user-a')
    await library.page.store.placeRecording(recording.id, 40)
    const database = await library.page.store.db()
    const [entry] = await database.getAll('outbox')
    await database.put('outbox', { ...entry, op: 'later' as OutboxOp })
    const toSend = await recorded(2)
    const before = library.account.sent.length
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(1)
    expect(library.account.sent.slice(before).filter(s => s.path.includes(recording.id))).toEqual(
      []
    )
    expect(library.account.isDeleted('recordings', recording.id)).toBe(false)
    expect(library.account.get('recordings', toSend.id)).toBeDefined()
    expect(await outbox()).toEqual([expect.objectContaining({ id: recording.id, op: 'later' })])
    expect((await library.page.store.loadRecordings()).map(r => r.id)).toContain(recording.id)
  })

  it('sends the delete of what reached the account, and nothing for what never did', async () => {
    const uploaded = await recorded(1)
    await library.page.sync.uploadBeforeSignOut('user-a')
    const local = await recorded(2, false)
    await library.page.store.deleteRecording(uploaded.id)
    await library.page.store.deleteRecording(local.id)
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.isDeleted('recordings', uploaded.id)).toBe(true)
    expect(library.account.sent.filter(s => s.path.includes(local.id))).toEqual([])
  })
})

function accountFullFor(kind: Kind) {
  const account = { full: true }
  library.account.intercept = sent => {
    if (sent.method === 'DELETE') account.full = false
    return account.full && sent.method === 'PUT' && sent.path.startsWith(`/api/${kind}/`)
      ? Response.json({ error: 'limit_reached' }, { status: 409 })
      : undefined
  }
  return account
}

const uploadsOf = (id: string) => requests('PUT').filter(s => s.path.includes(id)).length

describe('an account with no room', () => {
  beforeEach(() => claimedBy('user-a'))

  it('remembers on the upload that the account is full, for that kind only', async () => {
    const recording = await recorded(1)
    accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')

    expect(await outbox()).toEqual([
      expect.objectContaining({ id: recording.id, op: 'put', sent: false, accountFull: true })
    ])
    expect(await library.page.sync.waitingForRoom('recordings')).toBe(1)
    expect(await library.page.sync.waitingForRoom('toots')).toBe(0)
    expect(await library.page.sync.waitingForRoom()).toBe(1)
  })

  it('tells Sign out what waits for room only when it reached the account just now', async () => {
    await recorded(1)
    await recorded(2)
    accountFullFor('recordings')
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toEqual({ left: 2, full: 2 })

    library.account.offline = true
    expect(await library.page.sync.uploadBeforeSignOut('user-a')).toEqual({ left: 2, full: 0 })
  })

  it('uploads none of that kind again until there may be room, and still uploads the other kind', async () => {
    const first = await recorded(1)
    const second = await recorded(2)
    accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')
    expect(requests('PUT')).toHaveLength(1)

    const saved = newToot()
    await library.page.toots.saveToot(saved, wav(9))
    const third = await recorded(3)
    await library.page.sync.syncOnce('user-a')
    await library.page.sync.uploadBeforeSignOut('user-a')

    expect(library.account.get('toots', saved.id)).toBeDefined()
    expect(uploadsOf(first.id) + uploadsOf(second.id)).toBe(1)
    expect(uploadsOf(third.id)).toBe(0)
    expect(await library.page.sync.waitingForRoom('recordings')).toBe(3)
  })

  it('uploads what waits for room once a delete sent from here makes room, in the same sync', async () => {
    const uploaded = await recorded(1)
    await library.page.sync.syncOnce('user-a')
    const waiting = await recorded(2)
    const account = accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')
    account.full = false
    await library.page.sync.syncOnce('user-a')
    expect(uploadsOf(waiting.id)).toBe(1)

    await library.page.store.deleteRecording(uploaded.id)
    await library.page.sync.syncOnce('user-a')

    expect(library.account.get('recordings', waiting.id)).toBeDefined()
    expect(await outbox()).toEqual([])
    expect(await library.page.sync.waitingForRoom()).toBe(0)
    expect(library.account.sent.slice(-2).map(s => s.method)).toEqual(['DELETE', 'PUT'])
  })

  it("uploads what waits for room once a read shows another browser's delete", async () => {
    const other = anotherBrowsersRecording(1)
    library.account.add('recordings', other, wav(5))
    await library.page.sync.syncOnce('user-a')
    const waiting = await recorded(2)
    const account = accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')

    account.full = false
    library.account.remove('recordings', other.id)
    await library.page.sync.syncOnce('user-a')

    expect(uploadsOf(waiting.id)).toBe(2)
    expect(library.account.get('recordings', waiting.id)).toBeDefined()
    expect(await library.page.sync.waitingForRoom()).toBe(0)
  })

  it('tries once more in a new session or when Farty opens again, with one upload while still full', async () => {
    await recorded(1)
    await recorded(2)
    accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')

    await library.page.sync.claimLibrary('user-a')
    await library.page.sync.syncOnce('user-a')
    await library.page.sync.syncOnce('user-a')
    expect(requests('PUT')).toHaveLength(2)

    library.page = await openLibraryPage()
    library.account.intercept = null
    await library.page.sync.syncOnce('user-a')
    expect(requests('PUT')).toHaveLength(4)
    expect(await outbox()).toEqual([])
  })

  it('stops saying the account is full once the upload is refused for another reason', async () => {
    await recorded(1)
    accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.sync.waitingForRoom()).toBe(1)

    refuse('PUT', 413, 'too_large')
    await library.page.sync.claimLibrary('user-a')
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.sync.waitingForRoom()).toBe(0)
    expect(await outbox()).toHaveLength(1)
  })

  it('forgets a Recording deleted while it waits for room, with no request', async () => {
    const waiting = await recorded(1)
    accountFullFor('recordings')
    await library.page.sync.syncOnce('user-a')
    await library.page.store.deleteRecording(waiting.id)
    await library.page.sync.syncOnce('user-a')

    expect(library.account.sent.filter(s => s.method === 'DELETE')).toEqual([])
    expect(await outbox()).toEqual([])
    expect(await library.page.sync.waitingForRoom()).toBe(0)
  })

  it('stops counting a Toot as waiting for room once it uploads, though its rename waits', async () => {
    const saved = newToot('Old')
    await library.page.toots.saveToot(saved, wav(9))
    accountFullFor('toots')
    await library.page.sync.syncOnce('user-a')
    await library.page.toots.renameToot(saved.id, 'Renamed')
    expect(await library.page.sync.waitingForRoom('toots')).toBe(1)

    library.account.intercept = async sent => {
      if (sent.method === 'PUT') await library.page.toots.renameToot(saved.id, 'New')
      if (sent.method === 'PATCH') return Response.json({ error: 'unavailable' }, { status: 503 })
      return undefined
    }
    await library.page.sync.claimLibrary('user-a')
    await library.page.sync.syncOnce('user-a')

    expect(library.account.get('toots', saved.id)?.item).toMatchObject({ title: 'Renamed' })
    expect(await outbox()).toEqual([expect.objectContaining({ id: saved.id, op: 'rename' })])
    expect(await library.page.sync.waitingForRoom()).toBe(0)
  })
})
