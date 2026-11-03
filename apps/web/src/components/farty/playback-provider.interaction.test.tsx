import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { play, stopPlayback } from '@/lib/audio/player'
import { loadAudio } from '@/lib/recording-store'
import type { AnalysisState, Recording } from '@/lib/recordings'
import { PlaybackProvider, recordingSound, type Sound, usePlayback } from './playback-provider'

vi.mock('@/lib/audio/player', () => ({ play: vi.fn(), stopPlayback: vi.fn() }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: vi.fn(async () => new ArrayBuffer(8)) }))

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

function take(id: string, analysis: AnalysisState): Recording {
  return { id, number: 1, createdAt: 1, seconds: 3, sampleRate: 48_000, waveform: [], analysis }
}

const withASecondBurst: AnalysisState = {
  state: 'analyzed',
  analysis: {
    gestureStartSeconds: 0.4,
    gestureEndSeconds: 2.1,
    cutAtReattack: true,
    pitchEstimateMidi: null,
    pitchConfidence: 0,
    recordingPitchMidi: null,
    shortestNoteSeconds: 0.3
  }
}

const lastSegment = () => vi.mocked(play).mock.lastCall?.[2]

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

  it('replays a Recording as the whole take, start to end, from its saved file', async () => {
    await act(async () => playback.togglePlayback(recordingSound(take('r18', withASecondBurst))))
    const [key, load, segment] = vi.mocked(play).mock.calls[0]
    expect(key).toBe('r18')
    expect(segment).toBeNull()
    expect(playback.playingPart).toEqual({ startSeconds: 0, endSeconds: 3 })
    await load()
    expect(loadAudio).toHaveBeenCalledWith('r18')
  })

  it("plays a trimmed Recording's handles, and the part a scrub asks for", async () => {
    const fart = { startSeconds: 0.6, endSeconds: 1.1 }
    const trimmed = {
      ...take('r18', withASecondBurst),
      trim: { startSeconds: 0.5, endSeconds: 1.2, fart }
    }
    await act(async () => playback.togglePlayback(recordingSound(trimmed)))
    expect(lastSegment()).toEqual({ start: 0.5, end: 1.2 })
    expect(playback.playingPart).toEqual({ startSeconds: 0.5, endSeconds: 1.2 })

    await act(async () =>
      playback.playRecording(recordingSound(trimmed, { startSeconds: 0.9, endSeconds: 1.2 }))
    )
    expect(lastSegment()).toEqual({ start: 0.9, end: 1.2 })
    expect(playback.nowPlaying).toBe('r18')
    expect(stopPlayback).not.toHaveBeenCalled()

    const melodic = take('r19', { state: 'notAnalyzed' })
    await act(async () =>
      playback.togglePlayback(recordingSound({ ...melodic, trim: trimmed.trim }))
    )
    expect(lastSegment()).toEqual({ start: 0.5, end: 1.2 })
    await act(async () => playback.togglePlayback(recordingSound({ ...melodic, id: 'r20' })))
    expect(lastSegment()).toBeNull()
  })

  it('says no part plays once what played has ended', async () => {
    await act(async () => playback.togglePlayback(recordingSound(take('r18', withASecondBurst))))
    const ended = vi.mocked(play).mock.calls[0][3]
    await act(async () => ended())
    expect(playback.playingPart).toBeNull()
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
