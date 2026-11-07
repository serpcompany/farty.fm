'use client'

import { CircleAlert, Lock, Play, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** What a Toot's Play shows: Play or Stop, or why it can't play the farts. */
export type TootPlayShows = 'play' | 'stop' | 'locked' | 'making' | 'missing'

const icons: Record<TootPlayShows, ReactNode> = {
  play: <Play className="size-6 fill-current" />,
  stop: <Square className="size-5 fill-current" />,
  locked: <Lock className="size-6" />,
  making: <Spinner className="size-6" />,
  missing: <CircleAlert className="size-6" />
}

/**
 * A Toot's Play, with what it's doing ("Ready", "Playing") and a line under that, as the iPhone
 * app's `TootLayout` heads a Toot. Song Creator and a saved Toot's screen show it (`TootLayout`),
 * and so does a shared Toot's page (#451), so whoever opens a link sees the screen its Toot was
 * made on. `above` the state is Song Creator's Piano or Farts, and `children` are more lines under
 * the line. Its button is `<testId>-play` and its state `<testId>-state`.
 */
export function TootPlay({
  shows,
  label,
  disabled = false,
  onPress,
  above,
  state,
  line,
  testId,
  children
}: {
  shows: TootPlayShows
  /** What a tap does, for a screen reader: "Play", "Stop", or why it can't. */
  label: string
  disabled?: boolean
  onPress: () => void
  above?: ReactNode
  /** "Ready", "Playing". */
  state: string
  /** "6 of your Recordings, one per note". */
  line: ReactNode
  testId: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        aria-label={label}
        data-testid={`${testId}-play`}
        disabled={disabled}
        className={cn(
          'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          disabled
            ? 'bg-muted text-muted-foreground'
            : shows === 'stop'
              ? 'bg-primary text-primary-foreground'
              : 'bg-primary/10 text-primary'
        )}
        onClick={onPress}
      >
        {icons[shows]}
      </button>
      <div className="flex min-w-0 flex-col gap-1.5">
        {above}
        <div>
          <p className="font-semibold" data-testid={`${testId}-state`}>
            {state}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">{line}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
