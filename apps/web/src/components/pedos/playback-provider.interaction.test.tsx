import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { play, stopPlayback } from '@/lib/audio/player'
import { PlaybackProvider, type Sound, usePlayback } from './playback-provider'

vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: vi.fn() }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: vi.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let playback: ReturnType<typeof usePlayback>
let root: Root

function Probe() {
  playback = usePlayback()
  return null
}

const sound = (key: string): Sound => ({
  key,
  decodeKey: `decode-${key}`,
  wav: async () => new ArrayBuffer(0),
  segment: null
})

const toggle = (key: string) => act(async () => playback.togglePlayback(sound(key)))

function deferredPlays() {
  const starts: (() => void)[] = []
  vi.mocked(play).mockImplementation(() => new Promise<void>(start => starts.push(start)))
  return starts
}

beforeEach(async () => {
  vi.mocked(play).mockReset().mockResolvedValue(undefined)
  vi.mocked(stopPlayback).mockReset()
  root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <PlaybackProvider>
        <Probe />
      </PlaybackProvider>
    )
  )
})

afterEach(() => act(() => root.unmount()))

describe('PlaybackProvider', () => {
  it('shows a sound as playing until it ends', async () => {
    await toggle('a')
    expect(play).toHaveBeenCalledWith('decode-a', expect.any(Function), null, expect.any(Function))
    expect(playback.nowPlaying).toBe('a')

    const ended = vi.mocked(play).mock.calls[0][3]
    await act(async () => ended())
    expect(playback.nowPlaying).toBeNull()
  })

  it('stops the sound that plays when it is tapped again', async () => {
    await toggle('a')
    await toggle('a')
    expect(play).toHaveBeenCalledOnce()
    expect(stopPlayback).toHaveBeenCalledOnce()
  })

  it("keeps the later sound playing when the earlier one's end comes", async () => {
    await toggle('a')
    await toggle('b')
    const endedA = vi.mocked(play).mock.calls[0][3]
    await act(async () => endedA())
    expect(playback.nowPlaying).toBe('b')
  })

  it('says when the latest play started, not an earlier one', async () => {
    const starts = deferredPlays()
    vi.spyOn(performance, 'now').mockReturnValue(1234)
    await toggle('a')
    await toggle('b')
    await act(async () => starts[0]())
    expect(playback.playbackStartedAt).toBeNull()

    await act(async () => starts[1]())
    expect(playback.playbackStartedAt).toBe(1234)
  })

  it('has no start time once what played has ended', async () => {
    await toggle('a')
    expect(playback.playbackStartedAt).not.toBeNull()
    const ended = vi.mocked(play).mock.calls[0][3]
    await act(async () => ended())
    expect(playback.playbackStartedAt).toBeNull()
  })

  it('stops what plays when it is the stopped key or one of its parts', async () => {
    await toggle('toot:1:note:2')
    act(() => playback.stopPlaying('toot:2'))
    expect(stopPlayback).not.toHaveBeenCalled()

    act(() => playback.stopPlaying('toot:1'))
    expect(stopPlayback).toHaveBeenCalledOnce()
  })
})
