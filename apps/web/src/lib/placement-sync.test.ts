import { beforeEach, describe, expect, it } from 'vitest'
import type { LibraryChange } from '@/lib/library-changes'
import type { Placement } from '@/lib/recording-store'
import {
  anotherBrowsersRecording,
  bytes,
  claimedBy,
  libraryHarness,
  wav
} from '@/test-support/library-page'

const library = libraryHarness()
const { recorded, outbox, requests, placedWhileUploading, sendsAlone, keptWhileSending } = library

const trimmed = (start: number, end: number) => ({
  startSeconds: start,
  endSeconds: end,
  fart: { startSeconds: start, endSeconds: end }
})

async function changedOnAnotherBrowser(theirs: Placement) {
  const recording = anotherBrowsersRecording()
  library.account.add('recordings', recording, wav(5))
  await library.page.sync.syncOnce('user-a')
  const shown = [{ ...recording, analysis: { state: 'analyzing' } as const }]
  library.account.placeAndTrim(recording.id, theirs)
  const changes: LibraryChange[] = []
  library.page.changes.onLibraryChanged(change => changes.push(change))
  await library.page.sync.syncOnce('user-a')
  expect((await library.page.store.loadRecordings())[0]).toEqual(expect.objectContaining(theirs))
  const [change] = changes
  if (!change || change.reset) throw new Error('no change')
  expect(library.page.changes.recordingsAfter(shown, change)).toEqual([{ ...shown[0], ...theirs }])
  return { recording, changes }
}

describe("a Recording's Trim and name on the account (ADR 0019, #314)", () => {
  beforeEach(() => claimedBy('user-a'))

  it('trims a Recording on the account, in its upload or after it, keeping the take (ADR 0019)', async () => {
    const early = await recorded(1)
    const trim = trimmed(0.25, 0.75)
    await library.page.store.placeRecording(early.id, { placedPitch: 40, trim })
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', early.id)?.item).toMatchObject({
      placedPitch: 40,
      trim
    })
    expect(requests('PATCH')).toEqual([])
    await library.page.store.placeRecording(early.id, { trim: null })
    expect((await outbox()).map(e => e.op)).toEqual(['place'])
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', early.id)?.item).toMatchObject({
      placedPitch: 40,
      trim: null
    })
    expect(bytes(library.account.get('recordings', early.id)?.wav)).toEqual(bytes(wav(1)))
    expect(requests('PATCH').map(s => s.json)).toEqual([{ trim: null }])
  })

  it("sends a pitch-only change without the Trim, keeping another browser's Trim", async () => {
    const recording = await recorded(1)
    await library.page.sync.syncOnce('user-a')
    const trim = trimmed(0.2, 0.6)
    library.account.placeAndTrim(recording.id, { placedPitch: 36, trim })
    await library.page.store.placeRecording(recording.id, { placedPitch: 38 })
    await sendsAlone(recording.id, { placedPitch: 38 }, { placedPitch: 38, trim })
  })

  it("sends a trim-only change without the Placed Pitch, keeping another browser's newer one", async () => {
    const recording = await recorded(1)
    await library.page.store.placeRecording(recording.id, { placedPitch: 40 })
    await library.page.sync.syncOnce('user-a')
    library.account.place(recording.id, 45)
    const trim = trimmed(0.1, 0.5)
    await library.page.store.placeRecording(recording.id, { trim })
    await sendsAlone(recording.id, { trim }, { placedPitch: 45, trim })
  })

  it('names a Recording on the account, in its upload or after it, sending the name alone (#314)', async () => {
    const early = await recorded(1)
    await library.page.store.placeRecording(early.id, { placedPitch: -1, name: 'Squeaker' })
    expect((await library.page.sync.uploadBeforeSignOut('user-a')).left).toBe(0)
    expect(library.account.get('recordings', early.id)?.item).toMatchObject({
      placedPitch: -1,
      name: 'Squeaker'
    })
    expect(requests('PATCH')).toEqual([])
    library.account.place(early.id, 45)
    await library.page.store.placeRecording(early.id, { name: 'Big one' })
    await sendsAlone(early.id, { name: 'Big one' }, { placedPitch: 45, name: 'Big one' })
  })

  it("applies another browser's name, on the screen's Recordings too, but not over one it is sending", async () => {
    const { recording } = await changedOnAnotherBrowser({ name: 'From the phone' })
    await keptWhileSending(recording, { name: 'Mine' }, { name: 'Theirs' })
  })

  it('keeps both changes when two browsers change different fields offline', async () => {
    const recording = await recorded(1)
    await library.page.sync.syncOnce('user-a')
    const trim = trimmed(0.3, 0.7)
    library.account.offline = true
    await library.page.store.placeRecording(recording.id, { trim })
    await library.page.sync.syncOnce('user-a')
    library.account.offline = false
    library.account.place(recording.id, 50)
    await library.page.sync.syncOnce('user-a')
    expect(library.account.get('recordings', recording.id)?.item).toMatchObject({
      placedPitch: 50,
      trim
    })
    expect((await library.page.store.loadRecordings())[0]).toMatchObject({ placedPitch: 50, trim })
    library.account.offline = true
    await library.page.store.placeRecording(recording.id, { trim: null })
    await library.page.store.placeRecording(recording.id, { placedPitch: 52 })
    expect((await outbox()).map(e => e.fields)).toEqual([['placedPitch', 'trim']])
    library.account.offline = false
    await library.page.sync.syncOnce('user-a')
    expect(library.account.get('recordings', recording.id)?.item).toMatchObject({
      placedPitch: 52,
      trim: null
    })
  })

  it('trims a Recording on the account that was trimmed while it uploaded', async () => {
    await placedWhileUploading({ trim: trimmed(0.1, 0.4) })
  })

  it("keeps another browser's Trim, on the screen's Recordings too, but not over one it is sending", async () => {
    const trim = trimmed(0.2, 0.6)
    const { recording, changes } = await changedOnAnotherBrowser({ trim })
    library.account.placeAndTrim(recording.id, { trim: { ...trim } })
    changes.length = 0
    await library.page.sync.syncOnce('user-a')
    expect(changes).toEqual([])

    await keptWhileSending(recording, { trim: null }, { trim: trimmed(0.3, 0.5) })
  })
})
