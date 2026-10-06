import { cn } from '@/lib/utils'

/** Loudness bars, 0…1 each, as the iPhone app's `WaveformView`. */
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
      {levels.map((level, i) => (
        <span
          // Bars never reorder, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, static list
          key={i}
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
