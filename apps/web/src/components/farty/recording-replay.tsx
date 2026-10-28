'use client'

import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadAudio } from '@/lib/recording-store'
import { type Recording, replaySegment } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

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

export function useReplayLevels(recording: Recording): number[] {
  const [levels, setLevels] = useState<number[]>([])
  const segment = replaySegment(recording)
  const start = segment?.start
  const end = segment?.end
  const { id } = recording

  useEffect(() => {
    let current = true
    loadAudio(id)
      .then(wav => {
        const { samples, sampleRate } = decodeWav(wav)
        const from = start === undefined ? 0 : Math.max(0, Math.floor(start * sampleRate))
        const to = end === undefined ? samples.length : Math.floor(end * sampleRate)
        if (current) setLevels(waveformLevels(samples.subarray(from, to), 48))
      })
      .catch(() => {
        if (current) setLevels(Array(48).fill(0.05))
      })
    return () => {
      current = false
    }
  }, [id, start, end])

  return levels
}
