'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { play, type Segment, stopPlayback } from '@/lib/audio/player'
import { loadAudio } from '@/lib/recording-store'
import { type Recording, replaySegment } from '@/lib/recordings'

export type Sound = {
  key: string
  decodeKey: string
  wav: () => Promise<ArrayBuffer>
  segment: Segment | null
}

type Playback = {
  nowPlaying: string | null
  playbackStartedAt: number | null
  togglePlayback(sound: Sound): void
  stopPlaying(key: string): void
}

const PlaybackContext = createContext<Playback | null>(null)

export function usePlayback(): Playback {
  const playback = useContext(PlaybackContext)
  if (!playback) throw new Error('usePlayback needs a PlaybackProvider')
  return playback
}

export function recordingSound(recording: Recording): Sound {
  return {
    key: recording.id,
    decodeKey: recording.id,
    wav: () => loadAudio(recording.id),
    segment: replaySegment(recording)
  }
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [nowPlaying, setNowPlaying] = useState<string | null>(null)
  const [started, setStarted] = useState<{ key: string; at: number } | null>(null)
  const playing = useRef<string | null>(null)
  const plays = useRef(0)
  useEffect(() => {
    playing.current = nowPlaying
  }, [nowPlaying])

  const togglePlayback = useCallback(({ key, decodeKey, wav, segment }: Sound) => {
    if (playing.current === key) {
      stopPlayback()
      return
    }
    const ended = () => setNowPlaying(current => (current === key ? null : current))
    setNowPlaying(key)
    setStarted(null)
    plays.current += 1
    const thisPlay = plays.current
    void play(decodeKey, wav, segment, ended).then(() => {
      if (thisPlay === plays.current) setStarted({ key, at: performance.now() })
    })
  }, [])

  const stopPlaying = useCallback((key: string) => {
    const current = playing.current
    if (current === key || current?.startsWith(`${key}:`)) stopPlayback()
  }, [])

  const playbackStartedAt = started !== null && started.key === nowPlaying ? started.at : null
  const value = useMemo(
    () => ({ nowPlaying, playbackStartedAt, togglePlayback, stopPlaying }),
    [nowPlaying, playbackStartedAt, togglePlayback, stopPlaying]
  )
  return <PlaybackContext value={value}>{children}</PlaybackContext>
}
