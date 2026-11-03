'use client'

import type { ReactNode } from 'react'
import { formattedTootLength, type PadToot, type PadTootDraft } from '@/lib/toot'
import { usePlayback } from './playback-provider'
import { TootPlayButton, tootPlayState } from './toot-play-button'
import { tootPlayback, useToots } from './toots-provider'

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

export function PadTootLayout({
  toot,
  isAudioMissing = false,
  children
}: {
  toot: PadTootDraft | PadToot
  isAudioMissing?: boolean
  children?: ReactNode
}) {
  const { nowPlaying } = usePlayback()
  const { toggleTootPlayback, tootPlayFailed } = useToots()
  const isPlaying = nowPlaying === tootPlayback(toot.id)
  const { taps, recordings } = toot.performance

  return (
    <div className="flex items-start gap-4">
      <TootPlayButton
        isAudioMissing={isAudioMissing}
        isPlaying={isPlaying}
        testId="pad-toot-play"
        onClick={() => toggleTootPlayback(toot)}
      />
      <div className="min-w-0">
        <p className="font-semibold" data-testid="pad-toot-state">
          {tootPlayState(isAudioMissing, isPlaying, tootPlayFailed === toot.id)}
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formattedTootLength(toot.seconds)} · {plural(taps.length, 'tap')} of{' '}
          {plural(recordings.length, 'Recording')}
        </p>
        {children}
      </div>
    </div>
  )
}
