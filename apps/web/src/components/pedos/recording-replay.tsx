'use client'

import { Play, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { loadAudio } from '@/lib/recording-store'
import type { Recording, Trim } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { decodeWav, type PcmAudio } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

// What a Recording's row and the place-by-ear picker show of its replay: the play button and the
// waveform of the part replay plays: the whole take (ADR 0016), or its Trim (ADR 0019), or the
// stretch around the fart the picker zooms to.

/** How many bars a replay waveform draws. */
export const REPLAY_BARS = 48

/** The play button: a tinted circle, filled while playing. */
export function PlayCircle({ isPlaying }: { isPlaying: boolean }) {
  const Icon = isPlaying ? Square : Play
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-full',
        isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
      )}
    >
      <Icon className="size-4 fill-current" />
    </span>
  )
}

/**
 * The saved take, decoded: null while it loads, and silent when it can't be read, so its
 * waveform draws flat.
 */
export function useTake(recording: Recording): PcmAudio | null {
  const [take, setTake] = useState<{ id: string; audio: PcmAudio } | null>(null)
  const { id } = recording

  useEffect(() => {
    let current = true
    loadAudio(id)
      .then(wav => decodeWav(wav))
      .catch(() => ({ samples: new Float32Array(0), sampleRate: recording.sampleRate }))
      .then(audio => {
        if (current) setTake({ id, audio })
      })
    return () => {
      current = false
    }
  }, [id, recording.sampleRate])

  return take?.id === id ? take.audio : null
}

/** `REPLAY_BARS` loudness bars of `part` of a take, scaled so its loudest is 1. */
export function partLevels(take: PcmAudio, part: Trim): number[] {
  const from = Math.max(0, Math.round(part.startSeconds * take.sampleRate))
  const to = Math.min(take.samples.length, Math.round(part.endSeconds * take.sampleRate))
  return waveformLevels(take.samples.subarray(from, Math.max(from, to)), REPLAY_BARS)
}

/**
 * The bars of `part` of the take, or of the whole take, as replay plays it. None while the take
 * loads.
 */
export function useReplayLevels(recording: Recording, part?: Trim): number[] {
  const take = useTake(recording)
  const start = part?.startSeconds ?? 0
  const end = part?.endSeconds ?? Number.POSITIVE_INFINITY
  return useMemo(
    () => (take ? partLevels(take, { startSeconds: start, endSeconds: end }) : []),
    [take, start, end]
  )
}
