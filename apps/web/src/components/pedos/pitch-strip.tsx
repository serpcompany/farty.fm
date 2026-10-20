import { pitchClassNames } from '@/lib/pitch'
import { cn } from '@/lib/utils'

const sharps = new Set([1, 3, 6, 8, 10])
const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/**
 * A one-octave keyboard, C to B, that fills in each pitch class you've collected. Matches the
 * iPhone app's `PitchStrip`.
 *
 * - `collected`: pitch classes with a Melodic Recording, filled in.
 * - `outlined`: the pitch class of a Recording just made, outlined.
 * - `needed`: pitch classes a locked Song still needs, dashed.
 */
export function PitchStrip({
  collected,
  outlined = null,
  needed = new Set(),
  className
}: {
  collected: ReadonlySet<number>
  outlined?: number | null
  needed?: ReadonlySet<number>
  className?: string
}) {
  return (
    <div
      role="img"
      aria-label={describe(collected, outlined, needed)}
      className={cn('flex gap-[3px] py-1', className)}
      data-testid="pitch-strip"
    >
      {pitchClassNames.map((name, pitchClass) => {
        const isNeeded = needed.has(pitchClass)
        const isCollected = collected.has(pitchClass) && !isNeeded
        return (
          <span
            key={name}
            aria-hidden
            className={cn(
              'relative flex h-[38px] min-w-0 flex-1 items-end justify-center rounded-[5px] pb-[3px] text-[11px] leading-none',
              isCollected
                ? 'bg-primary font-semibold text-primary-foreground'
                : isNeeded
                  ? 'border-2 border-dashed border-foreground font-semibold text-foreground'
                  : 'border border-border text-muted-foreground',
              !isCollected && sharps.has(pitchClass) && 'bg-muted'
            )}
            data-collected={isCollected || undefined}
            data-needed={isNeeded || undefined}
          >
            {name}
            {outlined === pitchClass && (
              <span className="absolute -inset-[5px] rounded-[8px] border-3 border-foreground" />
            )}
          </span>
        )
      })}
    </div>
  )
}

/** "Notes collected: C, G, and G♯. New: G♯. Needed: D and F", as VoiceOver reads it. */
function describe(
  collected: ReadonlySet<number>,
  outlined: number | null,
  needed: ReadonlySet<number>
): string {
  const names = (set: ReadonlySet<number>) =>
    andList.format([...set].sort((a, b) => a - b).map(pc => pitchClassNames[pc]))
  const parts = [
    collected.size === 0 ? 'No notes collected yet' : `Notes collected: ${names(collected)}`
  ]
  if (outlined !== null) parts.push(`New: ${pitchClassNames[outlined]}`)
  if (needed.size > 0) parts.push(`Needed: ${names(needed)}`)
  return parts.join('. ')
}
