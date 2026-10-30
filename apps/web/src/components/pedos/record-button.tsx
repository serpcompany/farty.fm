'use client'

import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { InputLevel } from './pedos-provider'

/**
 * Record's states, as the button shows them (#281): a circle to record; the circle saying
 * "Starting…" while the microphone gets ready; once audio is coming in, a square to stop, with its
 * pulse and the live level; and the square, dimmed, while the take finishes after Stop.
 */
export type RecordButtonState = 'record' | 'starting' | 'recording' | 'finishing'

/** The square's share of the ring: the level grows from behind it to fill the ring. */
const squareShare = 76 / 188

/**
 * The big red button. It's the app's one signature control, so it's a stock Button shaped through
 * `className` and the `record` token.
 */
export function RecordButton({
  state,
  level,
  disabled,
  onClick
}: {
  state: RecordButtonState
  /** While recording, the live input level the button shows. */
  level?: InputLevel
  disabled?: boolean
  onClick: () => void
}) {
  const stops = state === 'recording' || state === 'finishing'
  return (
    <Button
      variant="ghost"
      aria-label={stops ? 'Stop' : state === 'starting' ? 'Starting…' : 'Record'}
      data-testid={stops ? 'stop-button' : 'record-button'}
      data-state={state}
      disabled={disabled || state === 'starting' || state === 'finishing'}
      onClick={onClick}
      className={cn(
        'relative size-50 rounded-full border-[6px] border-muted p-0 hover:bg-transparent active:not-aria-[haspopup]:translate-y-0',
        state === 'starting' && 'disabled:opacity-100'
      )}
    >
      {state === 'recording' && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border-4 border-record/50 motion-safe:animate-ping"
        />
      )}
      {state === 'recording' && level && <Level level={level} />}
      <span
        aria-hidden
        className={cn(
          'relative flex items-center justify-center bg-record text-lg font-semibold text-record-foreground transition-all duration-300',
          stops ? 'size-19 rounded-[14px]' : 'size-41 rounded-full',
          state === 'starting' && 'motion-safe:animate-pulse'
        )}
      >
        {state === 'starting' && 'Starting…'}
      </span>
    </Button>
  )
}

/** The live level: a disc behind the square, from hidden at the room's quiet to filling the ring. */
function Level({ level }: { level: InputLevel }) {
  const value = useSyncExternalStore(level.subscribe, level.current, () => 0)
  return (
    <span
      aria-hidden
      data-testid="input-level"
      data-level={value.toFixed(3)}
      className="absolute inset-0 rounded-full bg-record/25 transition-transform duration-100 ease-out motion-reduce:transition-none"
      style={{ transform: `scale(${squareShare + (1 - squareShare) * value})` }}
    />
  )
}
