'use client'

import { CircleAlert, Play, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

export function tootPlayState(
  isAudioMissing: boolean,
  isPlaying: boolean,
  playFailed: boolean
): string {
  if (isAudioMissing) return 'Audio missing'
  if (isPlaying) return 'Playing'
  return playFailed ? "Couldn't play" : 'Ready'
}

export function TootPlayButton({
  isAudioMissing,
  isPlaying,
  testId,
  onClick
}: {
  isAudioMissing: boolean
  isPlaying: boolean
  testId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={isAudioMissing ? 'Audio missing' : isPlaying ? 'Stop' : 'Play'}
      data-testid={testId}
      disabled={isAudioMissing}
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        isAudioMissing
          ? 'bg-muted text-muted-foreground'
          : isPlaying
            ? 'bg-primary text-primary-foreground'
            : 'bg-primary/10 text-primary'
      )}
      onClick={onClick}
    >
      {isAudioMissing ? (
        <CircleAlert className="size-6" />
      ) : isPlaying ? (
        <Square className="size-5 fill-current" />
      ) : (
        <Play className="size-6 fill-current" />
      )}
    </button>
  )
}
