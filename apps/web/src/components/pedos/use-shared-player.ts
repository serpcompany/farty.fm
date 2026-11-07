'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { play, type Segment, stopPlayback } from '@/lib/audio/player'
import type { Trim } from '@/lib/recordings'

/**
 * What's playing on a shared page: the item's own audio, whole or one note, or one of its
 * farts.
 */
type Sound = { of: 'item'; segment: Trim; note: number | null } | { of: 'fart'; place: number }

/**
 * A shared page's playing, one sound at a time: its own audio from a spot or one note of it, or
 * one fart of a Toot. `base` is the page's own path, which the audio is under.
 */
export function useSharedPlayer(base: string, part: Trim) {
  const [sound, setSound] = useState<Sound | null>(null)
  const [started, setStarted] = useState<{ sound: Sound; at: number } | null>(null)
  const [unplayable, setUnplayable] = useState<Sound['of'] | null>(null)
  const latest = useRef<Sound | null>(null)

  // Leaving the page stops it, as a tab change does in the app.
  useEffect(() => stopPlayback, [])

  const start = useCallback(
    (next: Sound, path: string, segment: Segment | null, from: number) => {
      latest.current = next
      setSound(next)
      setUnplayable(null)
      const url = `${base}${path}`
      void play(
        `shared:${url}`,
        async () => {
          const response = await fetch(url)
          if (!response.ok) {
            setUnplayable(next.of)
            throw new Error(`audio ${response.status}`)
          }
          return response.arrayBuffer()
        },
        segment,
        () => setSound(current => (current === next ? null : current))
      ).then(() => {
        // The playhead's 0 is the item's start, before `from`.
        if (latest.current === next)
          setStarted({ sound: next, at: performance.now() - from * 1000 })
      })
    },
    [base]
  )

  const playFrom = useCallback(
    (from: number) =>
      start(
        { of: 'item', segment: { startSeconds: from, endSeconds: part.endSeconds }, note: null },
        'audio/',
        { start: from, end: part.endSeconds },
        from
      ),
    [part.endSeconds, start]
  )

  return {
    sound,
    /** When the whole item started playing (`performance.now()`), for a roll's playhead. */
    startedAt:
      sound?.of === 'item' && sound.note === null && started?.sound === sound ? started.at : null,
    unplayable,
    playFrom,
    /** Plays one note of the item's own audio, from `from` to `to` seconds. */
    playNote: (note: number, from: number, to: number) =>
      start(
        { of: 'item', segment: { startSeconds: from, endSeconds: to }, note },
        'audio/',
        { start: from, end: to },
        from
      ),
    /** Plays one of a Toot's farts, on its own. */
    playFart: (place: number) => start({ of: 'fart', place }, `farts/${place}/audio/`, null, 0),
    stop: stopPlayback
  }
}

export type SharedPlayer = ReturnType<typeof useSharedPlayer>
