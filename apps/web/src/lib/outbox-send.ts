import { readableLibraryOwner } from './account'
import * as api from './library-api'
import { announceLibraryChange } from './library-changes'
import {
  announceSent,
  itemKey,
  type Kind,
  type OutboxEntry,
  placedFields,
  waitsForRoom
} from './outbox'
import { audioStore, type LibraryDatabase, withDb } from './recording-store'
import type { Recording } from './recordings'
import type { Toot } from './toot'

type Sent = 'next' | 'refused' | 'stop'

type Taken =
  | { entry: OutboxEntry; kind: Kind; op: 'put'; item: Recording | Toot; wav: ArrayBuffer }
  | { entry: OutboxEntry; kind: 'toots'; op: 'rename'; title: string }
  | { entry: OutboxEntry; kind: 'recordings'; op: 'place'; placement: api.Placement }
  | { entry: OutboxEntry; kind: Kind; op: 'delete' }
  | { entry: OutboxEntry; op: 'favorite'; on: boolean }

const stopsSending = ({ status, error }: api.Answer) =>
  status === 0 ||
  status === 401 ||
  status === 403 ||
  status === 429 ||
  status >= 500 ||
  (status === 409 && error === 'wrong_account')

const noRoom = new Set<Kind>()

export function roomMayExist(...kinds: Kind[]): void {
  for (const kind of kinds) noRoom.delete(kind)
}

function takeNext(skip: Set<string>): Promise<Taken | null> {
  return withDb(database => takeNextIn(database, skip))
}

async function takeNextIn(database: LibraryDatabase, skip: Set<string>): Promise<Taken | null> {
  const tx = database.transaction(
    ['outbox', 'recordings', 'audio', 'toots', 'tootAudio'],
    'readwrite'
  )
  const outbox = tx.objectStore('outbox')
  const entries = (await outbox.getAll())
    .filter(entry => !skip.has(entry.key))
    .sort((a, b) => a.queuedAt - b.queuedAt)
  for (const queued of entries) {
    const entry = { ...queued, sent: true }
    const kind = queued.kind
    if (kind === 'favorites') {
      if (queued.op !== 'put' && queued.op !== 'delete') continue
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, op: 'favorite', on: queued.op === 'put' }
    }
    if (queued.op === 'put') {
      if (noRoom.has(kind)) {
        if (!queued.accountFull) await outbox.put({ ...queued, accountFull: true })
        continue
      }
      const [item, wav] = await Promise.all([
        tx.objectStore(kind).get(queued.id),
        tx.objectStore(audioStore[kind]).get(queued.id)
      ])
      if (!item || !wav) {
        await outbox.delete(queued.key)
        continue
      }
      if ('analysis' in item && item.analysis.state === 'analyzing') {
        skip.add(queued.key)
        continue
      }
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, kind, op: 'put', item, wav }
    }
    if (queued.op === 'rename') {
      const toot = await tx.objectStore('toots').get(queued.id)
      if (!toot) {
        await outbox.delete(queued.key)
        continue
      }
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, kind: 'toots', op: 'rename', title: toot.title }
    }
    if (queued.op === 'place') {
      const recording = await tx.objectStore('recordings').get(queued.id)
      if (!recording) {
        await outbox.delete(queued.key)
        continue
      }
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, kind: 'recordings', op: 'place', placement: placementOf(recording, queued) }
    }
    if (queued.op === 'delete') {
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, kind, op: 'delete' }
    }
  }
  await tx.done
  return null
}

function placementOf(recording: Recording, queued: OutboxEntry): api.Placement {
  const placement: api.Placement = {}
  for (const field of placedFields(queued)) {
    if (field === 'placedPitch') placement.placedPitch = recording.placedPitch ?? null
    else if (field === 'trim') placement.trim = recording.trim ?? null
    else placement.name = recording.name ?? null
  }
  return placement
}

function settle(sent: OutboxEntry, then: 'done' | 'update' = 'done'): Promise<void> {
  return withDb(database => settleIn(database, sent, then))
}

async function settleIn(
  database: LibraryDatabase,
  sent: OutboxEntry,
  then: 'done' | 'update'
): Promise<void> {
  const tx = database.transaction('outbox', 'readwrite')
  const now = await tx.store.get(sent.key)
  const unchanged = now?.version === sent.version
  if (now && sent.kind === 'favorites') {
    if (unchanged) await tx.store.delete(sent.key)
  } else if (now?.op === 'delete') {
    if (sent.op === 'delete' && unchanged) await tx.store.delete(sent.key)
  } else if (now && sent.op === 'put') {
    if (then === 'update' || !unchanged) {
      const { accountFull: _, ...uploaded } = now
      const op = sent.kind === 'toots' ? 'rename' : 'place'
      await tx.store.put({ ...uploaded, op, sent: false, version: crypto.randomUUID() })
    } else await tx.store.delete(sent.key)
  } else if (unchanged) await tx.store.delete(sent.key)
  await tx.done
}

async function waitForRoom(kind: Kind, refused: OutboxEntry): Promise<void> {
  noRoom.add(kind)
  await withDb(async database => {
    const tx = database.transaction('outbox', 'readwrite')
    const now = await tx.store.get(refused.key)
    if (now?.op === 'put') await tx.store.put({ ...now, sent: false, accountFull: true })
    await tx.done
  })
}

async function forgetFull(refused: OutboxEntry): Promise<void> {
  await withDb(async database => {
    const tx = database.transaction('outbox', 'readwrite')
    const now = await tx.store.get(refused.key)
    if (now?.accountFull) await tx.store.put({ ...now, accountFull: undefined })
    await tx.done
  })
}

async function deleteHere(kind: Kind, id: string): Promise<void> {
  const key = itemKey(kind, id)
  await withDb(async database => {
    const tx = database.transaction([kind, audioStore[kind], 'downloads', 'outbox'], 'readwrite')
    await Promise.all([
      tx.objectStore(kind).delete(id),
      tx.objectStore(audioStore[kind]).delete(id),
      tx.objectStore('downloads').delete(key),
      tx.objectStore('outbox').delete(key),
      tx.done
    ])
  })
  const deleted = { recordings: [] as string[], toots: [] as string[] }
  deleted[kind].push(id)
  announceLibraryChange({ recordings: [], toots: [], deleted })
}

async function send(taken: Taken, accountId: string): Promise<Sent> {
  const { entry } = taken
  if (taken.op === 'favorite') {
    const answer = await api.setFavorite(entry.id, taken.on, accountId)
    if (stopsSending(answer)) return 'stop'
    await settle(entry)
    return 'next'
  }
  if (taken.op === 'put') {
    const answer = await api.putItem(taken.kind, taken.item, taken.wav, accountId)
    if (stopsSending(answer)) return 'stop'
    if (answer.status === 201 || answer.status === 200) {
      await settle(entry, answer.status === 200 ? 'update' : 'done')
      return 'next'
    }
    if (answer.status === 410) {
      await deleteHere(taken.kind, entry.id)
      return 'next'
    }
    if (answer.status === 409 && answer.error === 'limit_reached') {
      await waitForRoom(taken.kind, entry)
      return 'next'
    }
    if (waitsForRoom(entry)) await forgetFull(entry)
    return 'refused'
  }
  if (taken.op === 'rename' || taken.op === 'place') {
    const answer =
      taken.op === 'rename'
        ? await api.renameToot(entry.id, taken.title, accountId)
        : await api.placeRecording(entry.id, taken.placement, accountId)
    if (stopsSending(answer)) return 'stop'
    if (answer.status === 410) await deleteHere(taken.kind, entry.id)
    else await settle(entry)
    return 'next'
  }
  const answer = await api.deleteItem(taken.kind, entry.id, accountId)
  if (stopsSending(answer)) return 'stop'
  if (answer.status === 204) roomMayExist(taken.kind)
  await settle(entry)
  return 'next'
}

export async function sendOutbox(accountId: string): Promise<boolean> {
  const skip = new Set<string>()
  try {
    for (;;) {
      if (readableLibraryOwner() !== accountId) return false
      const taken = await takeNext(skip)
      if (!taken) return true
      const sent = await send(taken, accountId)
      if (sent === 'stop') return false
      if (sent === 'refused') skip.add(taken.entry.key)
    }
  } finally {
    announceSent()
  }
}
