'use client'

import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadAudio } from '@/lib/recording-store'
import type { Recording, Trim } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { decodeWav, type PcmAudio } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

const REPLAY_BARS = 48

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

function decodedTake(id: string, sampleRate: number): Promise<PcmAudio> {
  return loadAudio(id)
    .then(wav => decodeWav(wav))
    .catch(() => ({ samples: new Float32Array(0), sampleRate }))
}

export function useTake(recording: Recording): PcmAudio | null {
  const [take, setTake] = useState<{ id: string; audio: PcmAudio } | null>(null)
  const { id, sampleRate } = recording

  useEffect(() => {
    let current = true
    void decodedTake(id, sampleRate).then(audio => {
      if (current) setTake({ id, audio })
    })
    return () => {
      current = false
    }
  }, [id, sampleRate])

  return take?.id === id ? take.audio : null
}

export function partLevels(take: PcmAudio, part: Trim): number[] {
  const from = Math.max(0, Math.round(part.startSeconds * take.sampleRate))
  const to = Math.min(take.samples.length, Math.round(part.endSeconds * take.sampleRate))
  return waveformLevels(take.samples.subarray(from, Math.max(from, to)), REPLAY_BARS)
}

export function useReplayLevels(recording: Recording, part?: Trim): number[] {
  const [drawn, setDrawn] = useState<{ id: string; levels: number[] } | null>(null)
  const { id, sampleRate } = recording
  const start = part?.startSeconds ?? 0
  const end = part?.endSeconds ?? Number.POSITIVE_INFINITY

  useEffect(() => {
    let current = true
    void decodedTake(id, sampleRate).then(take => {
      const levels = partLevels(take, { startSeconds: start, endSeconds: end })
      if (current) setDrawn({ id, levels })
    })
    return () => {
      current = false
    }
  }, [id, sampleRate, start, end])

  return drawn?.id === id ? drawn.levels : NO_LEVELS
}

const NO_LEVELS: number[] = []
