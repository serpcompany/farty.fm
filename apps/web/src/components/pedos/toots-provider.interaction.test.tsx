import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDecoded, play, stopPlayback } from '@/lib/audio/player'
import { songs } from '@/lib/catalog/songs.generated'
import { type LibraryChange, onLibraryChanged } from '@/lib/library-sync'
import { reportError } from '@/lib/telemetry/errors'
import { noteSeconds, type Toot, type TootDraft } from '@/lib/toot'
import * as tootStore from '@/lib/toot-store'
import { PlaybackProvider, usePlayback } from './playback-provider'
import { TootsProvider, tootPlayback, useToots } from './toots-provider'

vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/toot-store', () => ({
  TootAudioMissing: class TootAudioMissing extends Error {},
  loadToots: vi.fn(),
  saveToot: vi.fn(),
  loadTootAudio: vi.fn(),
  renameToot: vi.fn(),
  deleteToot: vi.fn()
}))
vi.mock('@/lib/library-sync', () => ({ onLibraryChanged: vi.fn() }))
vi.mock('@/lib/audio/player', () => ({
  play: vi.fn(),
  stopPlayback: vi.fn(),
  forgetDecoded: vi.fn()
}))
vi.mock('@/lib/recording-store', () => ({ loadAudio: vi.fn() }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: vi.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const song = songs[0]
const arrangement = { transposition: 0, recordingForPitch: {} }

const savedToot = (id: string, createdAt: number): Toot => ({
  id,
  title: song.title,
  songId: song.id,
  createdAt,
  seconds: 9,
  arrangement
})

const madeToot = (id: string): TootDraft => ({
  id,
  song,
  arrangement,
  seconds: 9,
  wav: new ArrayBuffer(8)
})

let toots: ReturnType<typeof useToots>
let playback: ReturnType<typeof usePlayback>
let syncChanged: (change: LibraryChange) => void
let root: Root

function Probe() {
  toots = useToots()
  playback = usePlayback()
  return null
}

async function openWith(load: Promise<Toot[]>) {
  vi.mocked(tootStore.loadToots).mockReturnValue(load)
  root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <PlaybackProvider>
        <TootsProvider>
          <Probe />
        </TootsProvider>
      </PlaybackProvider>
    )
  )
}

function playedAudio(): Promise<ArrayBuffer> {
  const played = vi.mocked(play).mock.lastCall
  if (!played) throw new Error('Nothing played')
  return played[1]()
}

function listenForSync(listener: (change: LibraryChange) => void) {
  syncChanged = listener
  return () => undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tootStore.saveToot).mockResolvedValue(undefined)
  vi.mocked(tootStore.renameToot).mockResolvedValue(undefined)
  vi.mocked(tootStore.deleteToot).mockResolvedValue(undefined)
  vi.mocked(play).mockResolvedValue(undefined)
  vi.mocked(onLibraryChanged).mockImplementation(listenForSync)
})

afterEach(() => act(() => root.unmount()))

describe('TootsProvider', () => {
  it('keeps a Toot saved before the saved Toots load first', async () => {
    let loaded: (list: Toot[]) => void = () => undefined
    await openWith(new Promise(resolve => (loaded = resolve)))
    await act(() => toots.saveToot(madeToot('new')))
    await act(async () => loaded([savedToot('old', 1)]))

    expect(toots.toots?.map(t => t.id)).toEqual(['new', 'old'])
    expect(toots.toot('old')?.createdAt).toBe(1)
  })

  it('reports Toots that fail to load, and still lists those saved since', async () => {
    await openWith(Promise.reject(new TypeError('closed')))

    expect(reportError).toHaveBeenCalledWith('toots-load-failed', expect.any(TypeError))
    expect(toots.tootsFailed).toBe(true)
    expect(toots.toots).toEqual([])
  })

  it('saves a made Toot once', async () => {
    await openWith(Promise.resolve([]))
    await act(() => toots.saveToot(madeToot('t1')))
    await act(() => toots.saveToot(madeToot('t1')))

    expect(tootStore.saveToot).toHaveBeenCalledOnce()
    expect(toots.toot('t1')?.title).toBe(song.title)
  })

  it('renames a Toot with its title trimmed, and never to nothing', async () => {
    await openWith(Promise.resolve([savedToot('t1', 1)]))
    act(() => toots.renameToot('t1', '  Mine  '))
    act(() => toots.renameToot('t1', '   '))

    expect(toots.toot('t1')?.title).toBe('Mine')
    expect(tootStore.renameToot).toHaveBeenCalledExactlyOnceWith('t1', 'Mine')
  })

  it('stops a Toot that plays before it deletes it', async () => {
    await openWith(Promise.resolve([savedToot('t1', 1), savedToot('t2', 2)]))
    act(() => toots.toggleTootPlayback(savedToot('t1', 1), 0))
    act(() => toots.deleteToot('t1'))

    expect(stopPlayback).toHaveBeenCalledOnce()
    expect(forgetDecoded).toHaveBeenCalledWith('toot-t1')
    expect(tootStore.deleteToot).toHaveBeenCalledWith('t1')
    expect(toots.toots?.map(t => t.id)).toEqual(['t2'])
  })

  it('plays one note of a made Toot as written, from a copy of its audio', async () => {
    await openWith(Promise.resolve([]))
    const draft = madeToot('t1')
    act(() => toots.toggleTootPlayback(draft, 2))

    const written = noteSeconds(song, song.notes[2])
    const [decodeKey, , segment] = vi.mocked(play).mock.calls[0]
    expect(decodeKey).toBe('toot-t1')
    expect(segment).toEqual({ start: written.start, end: written.start + written.length })
    expect(playback.nowPlaying).toBe(tootPlayback('t1', 2))
    const audio = await playedAudio()
    expect(audio).not.toBe(draft.wav)
    expect(audio.byteLength).toBe(8)
  })

  it('marks a saved Toot whose audio is gone', async () => {
    await openWith(Promise.resolve([savedToot('t1', 1)]))
    vi.mocked(tootStore.loadTootAudio).mockRejectedValue(new tootStore.TootAudioMissing('t1'))
    act(() => toots.toggleTootPlayback(savedToot('t1', 1)))
    await act(() => playedAudio().catch(() => undefined))

    expect(reportError).toHaveBeenCalledWith('toot-audio-missing', expect.any(Error))
    expect(toots.toot('t1')?.isAudioMissing).toBe(true)
    expect(toots.tootPlayFailed).toBeNull()
  })

  it("says a saved Toot couldn't play until it plays again or its screen closes", async () => {
    await openWith(Promise.resolve([savedToot('t1', 1)]))
    vi.mocked(tootStore.loadTootAudio).mockRejectedValue(new TypeError('read failed'))
    act(() => toots.toggleTootPlayback(savedToot('t1', 1)))
    await act(() => playedAudio().catch(() => undefined))

    expect(reportError).toHaveBeenCalledWith('toot-audio-read-failed', expect.any(TypeError))
    expect(toots.tootPlayFailed).toBe('t1')
    act(() => toots.forgetToot('t1'))
    expect(toots.tootPlayFailed).toBeNull()
    expect(forgetDecoded).toHaveBeenCalledWith('toot-t1')
  })

  it('takes in what a sync changed, and stops a deleted Toot that plays', async () => {
    await openWith(Promise.resolve([savedToot('t2', 2), savedToot('t1', 1)]))
    act(() => toots.toggleTootPlayback(savedToot('t1', 1)))
    const renamed = { ...savedToot('t2', 2), title: 'Renamed' }

    act(() =>
      syncChanged({
        recordings: [],
        toots: [renamed, savedToot('t3', 3)],
        deleted: { recordings: [], toots: ['t1'] }
      })
    )

    expect(stopPlayback).toHaveBeenCalledOnce()
    expect(forgetDecoded).toHaveBeenCalledWith('toot-t1')
    expect(toots.toots?.map(t => [t.id, t.title])).toEqual([
      ['t3', song.title],
      ['t2', 'Renamed']
    ])
  })

  it('loads the Toots again after a sync reset', async () => {
    await openWith(Promise.resolve([savedToot('t1', 1)]))
    vi.mocked(tootStore.loadToots).mockResolvedValue([savedToot('t9', 9)])

    await act(async () => syncChanged({ reset: true }))

    expect(stopPlayback).toHaveBeenCalledOnce()
    expect(toots.toots?.map(t => t.id)).toEqual(['t9'])
  })
})
