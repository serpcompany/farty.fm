import { beforeEach, describe, expect, it } from 'vitest'
import type { LibraryChange } from '@/lib/library-changes'
import {
  anotherBrowsersRecording,
  bytes,
  claimedBy,
  libraryHarness,
  newToot,
  wav
} from '@/test-support/library-page'

const library = libraryHarness()
const { recorded, requests, refuse } = library

describe('reading the account', () => {
  beforeEach(() => claimedBy('user-a'))

  it("brings another browser's Recordings and Toots, and their WAVs as they were uploaded", async () => {
    const recording = anotherBrowsersRecording()
    const made = newToot()
    library.account.add('recordings', recording, wav(5))
    library.account.add('toots', made, wav(6))
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.store.loadRecordings()).toEqual([recording])
    expect(await library.page.toots.loadToots()).toEqual([made])
    expect(changes).toEqual([
      { recordings: [recording], toots: [made], deleted: { recordings: [], toots: [] } }
    ])
    expect(bytes(await library.page.store.loadAudio(recording.id))).toEqual(bytes(wav(5)))
    expect(bytes(await library.page.toots.loadTootAudio(made.id))).toEqual(bytes(wav(6)))
    expect(await (await library.page.store.db()).count('downloads')).toBe(0)
  })

  it('deletes what another browser deleted, reading only what changed since', async () => {
    const recording = anotherBrowsersRecording()
    library.account.add('recordings', recording, wav(5))
    await library.page.sync.syncOnce('user-a')
    library.account.remove('recordings', recording.id)
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect(changes).toEqual([
      { recordings: [], toots: [], deleted: { recordings: [recording.id], toots: [] } }
    ])
    const reads = requests('GET').filter(s => s.path.startsWith('/api/library/'))
    expect(reads.map(s => s.path)).toEqual([
      '/api/library/?since=0',
      expect.not.stringMatching(/since=0$/)
    ])
  })

  it("keeps what this browser is deleting deleted, and a title it's sending", async () => {
    const recording = anotherBrowsersRecording()
    const made = newToot('A')
    const doomed = newToot('D')
    library.account.add('recordings', recording, wav(5))
    library.account.add('toots', made, wav(6))
    library.account.add('toots', doomed, wav(7))
    await library.page.sync.syncOnce('user-a')
    refuse('DELETE', 503, 'unavailable')
    await library.page.store.deleteRecording(recording.id)
    await library.page.toots.deleteToot(doomed.id)
    await library.page.toots.renameToot(made.id, 'C')
    library.account.rename(made.id, 'B')
    library.account.rename(doomed.id, 'E')
    library.account.add('recordings', { ...recording }, wav(5))
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect((await library.page.toots.loadToots()).map(t => t.title)).toEqual(['C'])
  })

  it("applies another browser's rename of a Toot this browser isn't changing", async () => {
    const made = newToot('A')
    library.account.add('toots', made, wav(6))
    await library.page.sync.syncOnce('user-a')
    library.account.rename(made.id, 'B')
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.toots.loadToots())[0].title).toBe('B')
  })

  it("applies another browser's Placed Pitch, keeping this browser's own analysis (ADR 0015)", async () => {
    const recording = anotherBrowsersRecording()
    library.account.add('recordings', recording, wav(5))
    await library.page.sync.syncOnce('user-a')
    const analysis = { state: 'analyzing' } as const
    await library.page.store.saveAnalysis(recording.id, analysis)
    library.account.place(recording.id, 48)
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))
    await library.page.sync.syncOnce('user-a')
    const placed = { ...recording, analysis, placedPitch: 48 }
    expect(await library.page.store.loadRecordings()).toEqual([placed])
    expect(changes).toEqual([
      { recordings: [placed], toots: [], deleted: { recordings: [], toots: [] } }
    ])
    library.account.place(recording.id, 48)
    changes.length = 0
    await library.page.sync.syncOnce('user-a')
    expect(changes).toEqual([])
  })

  it("shows another browser's placement on the screen's Recordings, with this browser's analysis", async () => {
    const placedThere = anotherBrowsersRecording(1)
    const deletedThere = anotherBrowsersRecording(2)
    library.account.add('recordings', placedThere, wav(5))
    library.account.add('recordings', deletedThere, wav(6))
    await library.page.sync.syncOnce('user-a')
    const analysis = { state: 'analyzing' } as const
    const shown = [{ ...placedThere, analysis }, deletedThere]
    library.account.place(placedThere.id, 48)
    library.account.remove('recordings', deletedThere.id)
    const added = anotherBrowsersRecording(3)
    library.account.add('recordings', added, wav(7))
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))
    await library.page.sync.syncOnce('user-a')
    const [change] = changes
    if (!change || change.reset) throw new Error('no change')
    expect(library.page.changes.recordingsAfter(shown, change)).toEqual([
      { ...placedThere, analysis, placedPitch: 48 },
      added
    ])
  })

  it('keeps a Placed Pitch this browser is sending, and reads none from a Worker before #268 as no change', async () => {
    const recording = anotherBrowsersRecording()
    library.account.add('recordings', { ...recording, placedPitch: 40 }, wav(5))
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings())[0].placedPitch).toBe(40)
    refuse('PATCH', 503, 'unavailable')
    await library.page.store.placeRecording(recording.id, 41)
    library.account.place(recording.id, 42)
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings())[0].placedPitch).toBe(41)
    library.account.intercept = null
    await library.page.sync.syncOnce('user-a')
    library.account.add('recordings', recording, wav(5))
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings())[0].placedPitch).toBe(41)
  })

  it("drops what the account no longer has after a full read, but not what's waiting to upload", async () => {
    const gone = anotherBrowsersRecording()
    library.account.add('recordings', gone, wav(5))
    await library.page.sync.syncOnce('user-a')
    const waiting = await recorded(3, false)
    library.account.remove('recordings', gone.id)
    library.account.advance(31 * 24 * 60 * 60 * 1000)
    library.account.expireTombstones()
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings()).map(r => r.id)).toEqual([waiting.id])
  })

  it('downloads every WAV it waits for in the background', async () => {
    const recordings = [anotherBrowsersRecording(1), anotherBrowsersRecording(2)]
    for (const [i, recording] of recordings.entries())
      library.account.add('recordings', recording, wav(i))
    await library.page.sync.syncOnce('user-a')
    await library.page.sync.downloadAll(() => false)
    const database = await library.page.store.db()
    expect(await database.count('downloads')).toBe(0)
    expect(bytes(await database.get('audio', recordings[1].id))).toEqual(bytes(wav(1)))
  })

  it('marks a Toot missing once the account turns out to have lost its WAV', async () => {
    const made = newToot()
    library.account.add('toots', made, null)
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.toots.loadToots())[0].isAudioMissing).toBeUndefined()
    await expect(library.page.toots.loadTootAudio(made.id)).rejects.toBeInstanceOf(
      library.page.toots.TootAudioMissing
    )
    expect((await library.page.toots.loadToots())[0].isAudioMissing).toBe(true)
  })

  it('applies nothing it read once the library is claimed by another account', async () => {
    library.account.add('recordings', anotherBrowsersRecording(), wav(5))
    library.account.intercept = () => {
      claimedBy('user-b')
      return undefined
    }
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect(await (await library.page.store.db()).get('meta', 'cursor')).toBeUndefined()
  })

  it('never brings back a Recording deleted while its WAV downloaded', async () => {
    const recording = anotherBrowsersRecording()
    library.account.add('recordings', recording, wav(5))
    await library.page.sync.syncOnce('user-a')
    library.account.intercept = async sent => {
      if (sent.path.endsWith('/audio/')) await library.page.store.deleteRecording(recording.id)
      return undefined
    }
    await library.page.sync.downloadAll(() => false)
    const database = await library.page.store.db()
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect(await database.get('audio', recording.id)).toBeUndefined()
  })

  it("plays nothing it couldn't download, and tries again next time", async () => {
    const made = newToot()
    library.account.add('toots', made, wav(6))
    await library.page.sync.syncOnce('user-a')
    library.account.offline = true
    await expect(library.page.toots.loadTootAudio(made.id)).rejects.not.toBeInstanceOf(
      library.page.toots.TootAudioMissing
    )
    library.account.offline = false
    expect(bytes(await library.page.toots.loadTootAudio(made.id))).toEqual(bytes(wav(6)))
  })
})
