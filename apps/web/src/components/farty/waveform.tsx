import { cn } from '@/lib/utils'

export function Waveform({
  levels,
  isPlaying = false,
  className
}: {
  levels: number[]
  isPlaying?: boolean
  className?: string
}) {
  return (
    <div aria-hidden className={cn('flex items-center gap-[2px]', className)}>
      {Array.from(levels.entries(), ([slot, level]) => (
        <span
          key={slot}
          className={cn(
            'min-h-[2px] flex-1 rounded-full',
            isPlaying ? 'bg-primary' : 'bg-muted-foreground/60'
          )}
          style={{ height: `${Math.max(level, 0.05) * 100}%` }}
        />
      ))}
    </div>
  )
}
