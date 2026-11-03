import type { IDBPObjectStore, StoreNames } from 'idb'
import { readableLibraryOwner } from './account'
import { favoritesChanged } from './favorite-store'
import * as api from './library-api'
import { announceLibraryChange } from './library-changes'
import {
  itemKey,
  type Kind,
  type OutboxEntry,
  type OutboxOp,
  type PlacedField,
  placedFieldNames,
  placedFields
} from './outbox'
import { roomMayExist } from './outbox-send'
import { audioStore, type FartyDB, type LibraryDatabase, withDb } from './recording-store'
import type { Recording, Trim } from './recordings'
import type { Toot } from './toot'

const kinds = ['recordings', 'toots'] as const

export async function pullAccountChanges(accountId: string): Promise<boolean> {
  const since = (await withDb(database => database.get('meta', 'cursor'))) ?? 0
  const answer = await api.getLibrary(since, accountId)
  if (!('cursor' in answer) || readableLibraryOwner() !== accountId) return false
  const { favoritesMoved, ...change } = await withDb(database => apply(database, answer))
  if (favoritesMoved) favoritesChanged()
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
    ['recordings', 'audio', 'toots', 'tootAudio', 'downloads', 'outbox', 'meta', 'favorites'],
    'readwrite'
  )
  const recordings = tx.objectStore('recordings')
  const toots = tx.objectStore('toots')
  const downloads = tx.objectStore('downloads')
  const outbox = tx.objectStore('outbox')
  const entries = new Map((await outbox.getAll()).map(entry => [entry.key, entry]))
  const pending = new Map([...entries].map(([key, entry]) => [key, entry.op]))
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
    if (pending.get(key) === 'delete') continue
    const here = await recordings.get(recording.id)
    if (here) {
      const moved = placedFromAccount(here, recording, entries.get(key))
      if (!moved) continue
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
      if (pending.get(itemKey(kind, id)) === 'put') continue
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
  const favoritesMoved = await applyFavorites(tx.objectStore('favorites'), answer, pending)
  const listed = new Set(answer.recordings.map(r => r.id))
  const waitsToUpload = (r: Recording) =>
    pending.get(itemKey('recordings', r.id)) === 'put' && !listed.has(r.id)
  for (const renumbered of renumberWaiting(await recordings.getAll(), waitsToUpload)) {
    await recordings.put(renumbered)
    change.recordings.push(renumbered)
  }
  await Promise.all([tx.objectStore('meta').put(answer.cursor, 'cursor'), tx.done])
  return { ...change, favoritesMoved }
}

function placedFromAccount(
  here: Recording,
  read: Recording,
  entry: OutboxEntry | undefined
): Recording | null {
  const held: readonly PlacedField[] = !entry
    ? []
    : entry.op === 'place'
      ? placedFields(entry)
      : placedFieldNames
  const moved: Recording = { ...here }
  if (read.placedPitch !== undefined && !held.includes('placedPitch'))
    moved.placedPitch = read.placedPitch
  if (read.trim !== undefined && !held.includes('trim')) moved.trim = read.trim
  if (read.name !== undefined && !held.includes('name')) moved.name = read.name
  const same =
    (here.placedPitch ?? null) === (moved.placedPitch ?? null) &&
    sameTrim(here.trim ?? null, moved.trim ?? null) &&
    (here.name ?? null) === (moved.name ?? null)
  return same ? null : moved
}

function sameTrim(a: Trim | null, b: Trim | null): boolean {
  if (a === null || b === null) return a === b
  return a.startSeconds === b.startSeconds && a.endSeconds === b.endSeconds
}

async function applyFavorites(
  favorites: IDBPObjectStore<FartyDB, StoreNames<FartyDB>[], 'favorites', 'readwrite'>,
  answer: api.LibraryChanges,
  pending: Map<string, OutboxOp>
): Promise<boolean> {
  const sending = (songId: string) => pending.has(itemKey('favorites', songId))
  let moved = false
  for (const songId of answer.favorites ?? []) {
    if (sending(songId) || (await favorites.getKey(songId)) !== undefined) continue
    await favorites.put(Date.now(), songId)
    moved = true
  }
  for (const songId of answer.deleted.favorites ?? []) {
    if (sending(songId) || (await favorites.getKey(songId)) === undefined) continue
    await favorites.delete(songId)
    moved = true
  }
  if (answer.full && answer.favorites) {
    const listed = new Set(answer.favorites)
    for (const songId of await favorites.getAllKeys()) {
      if (listed.has(songId) || sending(songId)) continue
      await favorites.delete(songId)
      moved = true
    }
  }
  return moved
}

function renumberWaiting(all: Recording[], waits: (recording: Recording) => boolean): Recording[] {
  const waiting = all.filter(waits).sort((a, b) => a.number - b.number)
  const highest = Math.max(0, ...all.filter(r => !waits(r)).map(r => r.number))
  if (waiting.length === 0 || waiting[0].number > highest) return []
  return waiting.map((recording, i) => ({ ...recording, number: highest + 1 + i }))
}
