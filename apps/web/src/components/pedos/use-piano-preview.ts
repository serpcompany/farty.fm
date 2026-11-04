'use client'

import { useEffect, useRef, useState } from 'react'
import { usePedos } from './pedos-provider'
import { type PianoNote, pianoPosition, playPiano, stopPiano } from './piano-preview'

/** What the piano plays: a Song's melody, or one note of it, by its index. */
export type PianoTarget = 'song' | number

/** The piano playing, and when its notes' 0 reached the speaker (`performance.now()`), once known. */
export type PianoPlaying = { target: PianoTarget; startedAt: number | null }

/**
 * A screen's melody on piano (#359), as one player with Farty's: playing it stops what Farty
 * plays, anything Farty plays stops it, and so does leaving the screen.
 */
export function usePianoPreview(): {
  playing: PianoPlaying | null
  play(target: PianoTarget, notes: readonly PianoNote[], from?: number): void
  stop(): void
  /** Where the piano is in its notes, in seconds, by the audio clock; null while it doesn't play. */
  position(): number | null
} {
  const pedos = usePedos()
  const [playing, setPlaying] = useState<PianoPlaying | null>(null)
  /** Counts every play: only the latest one's start and end count. */
  const plays = useRef(0)

  const play = (target: PianoTarget, notes: readonly PianoNote[], from = 0) => {
    pedos.stopPlayback()
    plays.current += 1
    const thisPlay = plays.current
    setPlaying({ target, startedAt: null })
    playPiano(notes, {
      from,
      onStarted: startedAt => {
        if (thisPlay === plays.current) setPlaying({ target, startedAt })
      },
      onEnded: () => {
        if (thisPlay === plays.current) setPlaying(null)
      }
    })
  }

  // Farty plays something else.
  useEffect(() => {
    if (pedos.nowPlaying !== null) stopPiano()
  }, [pedos.nowPlaying])
  // The screen closes.
  useEffect(() => stopPiano, [])

  return { playing, play, stop: stopPiano, position: pianoPosition }
}
