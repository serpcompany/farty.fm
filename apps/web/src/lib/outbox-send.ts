import { readableLibraryOwner } from './account'
import * as api from './library-api'
import { announceLibraryChange } from './library-changes'
import { itemKey, type Kind, type OutboxEntry } from './outbox'
import { audioStore, type LibraryDatabase, withDb } from './recording-store'
import type { Recording } from './recordings'
import type { Toot } from './toot'

type Sent = 'next' | 'refused' | 'stop'

type Taken =
  | { entry: OutboxEntry; op: 'put'; item: Recording | Toot; wav: ArrayBuffer }
  | { entry: OutboxEntry; op: 'rename'; title: string }
  | { entry: OutboxEntry; op: 'delete' }

const stopsSending = ({ status, error }: api.Answer) =>
  status === 0 ||
  status === 401 ||
  status === 403 ||
  status === 429 ||
  status >= 500 ||
  (status === 409 && error === 'wrong_account')

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
    if (queued.op === 'put') {
      const [item, wav] = await Promise.all([
        tx.objectStore(queued.kind).get(queued.id),
        tx.objectStore(audioStore[queued.kind]).get(queued.id)
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
      return { entry, op: 'put', item, wav }
    }
    if (queued.op === 'rename') {
      const toot = await tx.objectStore('toots').get(queued.id)
      if (!toot) {
        await outbox.delete(queued.key)
        continue
      }
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, op: 'rename', title: toot.title }
    }
    await Promise.all([outbox.put(entry), tx.done])
    return { entry, op: 'delete' }
  }
  await tx.done
  return null
}

function settle(sent: OutboxEntry, then: 'done' | 'rename' = 'done'): Promise<void> {
  return withDb(database => settleIn(database, sent, then))
}

async function settleIn(
  database: LibraryDatabase,
  sent: OutboxEntry,
  then: 'done' | 'rename'
): Promise<void> {
  const tx = database.transaction('outbox', 'readwrite')
  const now = await tx.store.get(sent.key)
  const unchanged = now?.version === sent.version
  if (now?.op === 'delete') {
    if (sent.op === 'delete' && unchanged) await tx.store.delete(sent.key)
  } else if (now && sent.op === 'put') {
    if (sent.kind === 'toots' && (then === 'rename' || !unchanged)) {
      await tx.store.put({ ...now, op: 'rename', sent: false, version: crypto.randomUUID() })
    } else await tx.store.delete(sent.key)
  } else if (unchanged) await tx.store.delete(sent.key)
  await tx.done
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
  if (taken.op === 'put') {
    const answer = await api.putItem(entry.kind, taken.item, taken.wav, accountId)
    if (stopsSending(answer)) return 'stop'
    if (answer.status === 201 || answer.status === 200) {
      await settle(entry, answer.status === 200 ? 'rename' : 'done')
      return 'next'
    }
    if (answer.status === 410) {
      await deleteHere(entry.kind, entry.id)
      return 'next'
    }
    return 'refused'
  }
  if (taken.op === 'rename') {
    const answer = await api.renameToot(entry.id, taken.title, accountId)
    if (stopsSending(answer)) return 'stop'
    if (answer.status === 410) await deleteHere(entry.kind, entry.id)
    else await settle(entry)
    return 'next'
  }
  const answer = await api.deleteItem(entry.kind, entry.id, accountId)
  if (stopsSending(answer)) return 'stop'
  await settle(entry)
  return 'next'
}

export async function sendOutbox(accountId: string): Promise<boolean> {
  const skip = new Set<string>()
  for (;;) {
    if (readableLibraryOwner() !== accountId) return false
    const taken = await takeNext(skip)
    if (!taken) return true
    const sent = await send(taken, accountId)
    if (sent === 'stop') return false
    if (sent === 'refused') skip.add(taken.entry.key)
  }
}
