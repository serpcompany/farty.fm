'use client'

import { ChevronRight, Play, Square, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Waveform } from './waveform'

// A row of "Recordings used": what a Toot's screen and a shared Toot's page both draw.

/**
 * A Recording the Toot uses: the color of its notes, play, its name, its waveform and its fart's
 * length, `when` it was recorded on a shared page, "Your pick" when the user swapped it in (#360),
 * and the note it plays in the Song. As the iPhone app's `RecordingRow` in Song Creator, which
 * shows the whole take's length.
 */
export function RecordingUsedRowView({
  name,
  length,
  levels,
  color,
  label,
  when,
  isPlaying,
  isHighlighted,
  isYourPick = false,
  badge,
  disabled = false,
  onTap
}: {
  name: string
  length: string
  levels: number[]
  color: string
  /** What a screen reader says of the row. */
  label: string
  when?: string | null
  isPlaying: boolean
  isHighlighted: boolean
  isYourPick?: boolean
  badge?: ReactNode
  /** It has nothing to play. */
  disabled?: boolean
  onTap: () => void
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 py-2 pr-4 pl-4',
        (isPlaying || isHighlighted) && 'bg-primary/10'
      )}
      data-testid="recording-used"
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        aria-label={label}
        aria-pressed={isPlaying}
        disabled={disabled}
        onClick={onTap}
      >
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span
          aria-hidden
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
          )}
        >
          {isPlaying ? (
            <Square className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span>{name}</span>
          <span className="flex items-center gap-2">
            <Waveform
              levels={levels}
              isPlaying={isPlaying}
              className="h-[18px] w-[72px] gap-[1.5px]"
            />
            <span className="text-sm text-muted-foreground">{length}</span>
          </span>
          {when && <span className="text-sm text-muted-foreground tabular-nums">{when}</span>}
          {isYourPick && <span className="text-sm font-semibold text-brand-strong">Your pick</span>}
        </span>
      </button>
      {badge}
    </li>
  )
}

/** A Recording the Toot used that has since been deleted: the note it played, and no play button. */
export function DeletedRecordingRow({
  color,
  isHighlighted,
  badge
}: {
  color: string
  isHighlighted: boolean
  badge?: ReactNode
}) {
  return (
    <li
      className={cn(
        'flex min-h-15 items-center gap-3 py-2 pr-4 pl-4',
        isHighlighted && 'bg-primary/10'
      )}
      data-testid="recording-used"
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Trash2 className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-muted-foreground">Recording deleted</span>
      {badge}
    </li>
  )
}

/**
 * "plays F3": the note a Recording plays in the Song. In Song Creator it opens the fart sheet for
 * that pitch (#360).
 */
export function PlaysBadge({ plays, onChangeFart }: { plays: string; onChangeFart?: () => void }) {
  const pill = 'shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold tabular-nums'
  if (!onChangeFart) {
    return (
      <span aria-hidden className={pill}>
        plays {plays}
      </span>
    )
  }
  // A thumb's 44 points around the pill.
  return (
    <button
      type="button"
      aria-label={`Change the fart for ${plays}`}
      className="-my-1 flex h-11 shrink-0 items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onChangeFart}
    >
      <span
        className={cn(pill, 'flex h-9 items-center gap-0.5 bg-background pr-2 ring-1 ring-border')}
      >
        plays {plays}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </span>
    </button>
  )
}
