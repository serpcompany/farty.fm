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
import { type Recording, type Trim, trimHandles } from '@/lib/recordings'

export type Sound = {
  key: string
  decodeKey: string
  wav: () => Promise<ArrayBuffer>
  segment: Segment | null
  part?: Trim
}

type Playback = {
  nowPlaying: string | null
  playbackStartedAt: number | null
  playingPart: Trim | null
  togglePlayback(sound: Sound): void
  playRecording(sound: Sound): void
  stopPlaying(key: string): void
}

const PlaybackContext = createContext<Playback | null>(null)

export function usePlayback(): Playback {
  const playback = useContext(PlaybackContext)
  if (!playback) throw new Error('usePlayback needs a PlaybackProvider')
  return playback
}

export function takeSound(
  take: Pick<Sound, 'key' | 'decodeKey' | 'wav'> & { seconds: number },
  part: Trim | null
): Sound {
  return {
    key: take.key,
    decodeKey: take.decodeKey,
    wav: take.wav,
    segment: part && { start: part.startSeconds, end: part.endSeconds },
    part: part ?? { startSeconds: 0, endSeconds: take.seconds }
  }
}

export function recordingSound(
  recording: Recording,
  part: Trim | null = trimHandles(recording)
): Sound {
  const { id, seconds } = recording
  return takeSound({ key: id, decodeKey: id, wav: () => loadAudio(id), seconds }, part)
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [nowPlaying, setNowPlaying] = useState<string | null>(null)
  const [playingPart, setPlayingPart] = useState<Trim | null>(null)
  const [started, setStarted] = useState<{ key: string; at: number } | null>(null)
  const playing = useRef<string | null>(null)
  const plays = useRef(0)
  useEffect(() => {
    playing.current = nowPlaying
  }, [nowPlaying])

  const playRecording = useCallback(({ key, decodeKey, wav, segment, part }: Sound) => {
    const ended = () => setNowPlaying(current => (current === key ? null : current))
    setNowPlaying(key)
    setPlayingPart(part ?? null)
    setStarted(null)
    plays.current += 1
    const thisPlay = plays.current
    void play(decodeKey, wav, segment, ended).then(() => {
      if (thisPlay === plays.current) setStarted({ key, at: performance.now() })
    })
  }, [])

  const togglePlayback = useCallback(
    (sound: Sound) => {
      if (playing.current === sound.key) stopPlayback()
      else playRecording(sound)
    },
    [playRecording]
  )

  const stopPlaying = useCallback((key: string) => {
    const current = playing.current
    if (current === key || current?.startsWith(`${key}:`)) stopPlayback()
  }, [])

  const playbackStartedAt = started !== null && started.key === nowPlaying ? started.at : null
  const value = useMemo(
    () => ({
      nowPlaying,
      playbackStartedAt,
      playingPart: nowPlaying === null ? null : playingPart,
      togglePlayback,
      playRecording,
      stopPlaying
    }),
    [nowPlaying, playbackStartedAt, playingPart, togglePlayback, playRecording, stopPlaying]
  )
  return <PlaybackContext value={value}>{children}</PlaybackContext>
}
