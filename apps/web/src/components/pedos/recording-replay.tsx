'use client'

import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadAudio } from '@/lib/recording-store'
import type { Recording } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

// What a Recording's row and the place-by-ear picker show of its replay: the play button and the
// waveform of the whole take, which replay plays start to end (ADR 0016).

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

/** 48 loudness bars of the whole take, as replay plays it. */
export function useReplayLevels(recording: Recording): number[] {
  const [levels, setLevels] = useState<number[]>([])
  const { id } = recording

  useEffect(() => {
    let current = true
    loadAudio(id)
      .then(wav => {
        if (current) setLevels(waveformLevels(decodeWav(wav).samples, 48))
      })
      .catch(() => {
        if (current) setLevels(Array(48).fill(0.05))
      })
    return () => {
      current = false
    }
  }, [id])

  return levels
}
