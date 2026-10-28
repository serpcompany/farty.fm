import { readableLibraryOwner } from './account'
import * as api from './library-api'
import { announceLibraryChange } from './library-changes'
import { itemKey, type Kind } from './outbox'
import { roomMayExist } from './outbox-send'
import { audioStore, type LibraryDatabase, withDb } from './recording-store'
import type { Recording } from './recordings'
import type { Toot } from './toot'

const kinds = ['recordings', 'toots'] as const

export async function pullAccountChanges(accountId: string): Promise<boolean> {
  const since = (await withDb(database => database.get('meta', 'cursor'))) ?? 0
  const answer = await api.getLibrary(since, accountId)
  if (!('cursor' in answer) || readableLibraryOwner() !== accountId) return false
  const change = await withDb(database => apply(database, answer))
  roomMayExist(...kinds.filter(kind => change.deleted[kind].length > 0))
  const changed =
    change.recordings.length +
    change.toots.length +
    change.deleted.recordings.length +
    change.deleted.toots.length
  if (changed > 0) announceLibraryChange(change)
  return true
}

async function apply(database: LibraryDatabase, answer: api.LibraryChanges) {
  const tx = database.transaction(
    ['recordings', 'audio', 'toots', 'tootAudio', 'downloads', 'outbox', 'meta'],
    'readwrite'
  )
  const recordings = tx.objectStore('recordings')
  const toots = tx.objectStore('toots')
  const downloads = tx.objectStore('downloads')
  const outbox = tx.objectStore('outbox')
  const pending = new Map((await outbox.getAll()).map(entry => [entry.key, entry.op]))
  const change = {
    recordings: [] as Recording[],
    toots: [] as Toot[],
    deleted: { recordings: [] as string[], toots: [] as string[] }
  }
  const remove = async (kind: Kind, id: string) => {
    const key = itemKey(kind, id)
    await Promise.all([
      tx.objectStore(kind).delete(id),
      tx.objectStore(audioStore[kind]).delete(id),
      downloads.delete(key),
      outbox.delete(key)
    ])
    change.deleted[kind].push(id)
  }

  for (const { audioBytes: _, ...recording } of answer.recordings) {
    const key = itemKey('recordings', recording.id)
    const op = pending.get(key)
    if (op === 'delete') continue
    const here = await recordings.get(recording.id)
    if (here) {
      const placed = recording.placedPitch
      if (op || placed === undefined || (here.placedPitch ?? null) === placed) continue
      const moved = { ...here, placedPitch: placed }
      await recordings.put(moved)
      change.recordings.push(moved)
      continue
    }
    await Promise.all([
      recordings.put(recording),
      downloads.put({ kind: 'recordings', id: recording.id }, key)
    ])
    change.recordings.push(recording)
  }
  for (const { audioBytes: _, ...toot } of answer.toots) {
    const key = itemKey('toots', toot.id)
    const op = pending.get(key)
    if (op === 'delete') continue
    const here = await toots.get(toot.id)
    if (here) {
      if (op || here.title === toot.title) continue
      const renamed = { ...here, title: toot.title }
      await toots.put(renamed)
      change.toots.push(renamed)
    } else {
      await Promise.all([toots.put(toot), downloads.put({ kind: 'toots', id: toot.id }, key)])
      change.toots.push(toot)
    }
  }
  for (const kind of kinds) {
    for (const id of answer.deleted[kind]) {
      if (await tx.objectStore(kind).getKey(id)) await remove(kind, id)
      else await outbox.delete(itemKey(kind, id))
    }
  }
  if (answer.full) {
    const listed = {
      recordings: new Set(answer.recordings.map(r => r.id)),
      toots: new Set(answer.toots.map(t => t.id))
    }
    for (const kind of kinds) {
      for (const id of await tx.objectStore(kind).getAllKeys()) {
        if (!listed[kind].has(id) && pending.get(itemKey(kind, id)) !== 'put')
          await remove(kind, id)
      }
    }
  }
  const listed = new Set(answer.recordings.map(r => r.id))
  const waitsToUpload = (r: Recording) =>
    pending.get(itemKey('recordings', r.id)) === 'put' && !listed.has(r.id)
  for (const renumbered of renumberWaiting(await recordings.getAll(), waitsToUpload)) {
    await recordings.put(renumbered)
    change.recordings.push(renumbered)
  }
  await Promise.all([tx.objectStore('meta').put(answer.cursor, 'cursor'), tx.done])
  return change
}

function renumberWaiting(all: Recording[], waits: (recording: Recording) => boolean): Recording[] {
  const waiting = all.filter(waits).sort((a, b) => a.number - b.number)
  const highest = Math.max(0, ...all.filter(r => !waits(r)).map(r => r.number))
  if (waiting.length === 0 || waiting[0].number > highest) return []
  return waiting.map((recording, i) => ({ ...recording, number: highest + 1 + i }))
}
