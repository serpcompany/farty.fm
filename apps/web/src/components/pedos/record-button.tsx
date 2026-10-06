'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The big red button: a circle to record, a square to stop. It's the app's one signature
 * control, so it's a stock Button shaped through `className` and the `record` token.
 */
export function RecordButton({
  isRecording,
  disabled,
  onClick
}: {
  isRecording: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={isRecording ? 'Stop' : 'Record'}
      data-testid={isRecording ? 'stop-button' : 'record-button'}
      disabled={disabled}
      onClick={onClick}
      className="relative size-50 rounded-full border-[6px] border-muted p-0 hover:bg-transparent active:not-aria-[haspopup]:translate-y-0"
    >
      {isRecording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border-4 border-record/50 motion-safe:animate-ping"
        />
      )}
      <span
        aria-hidden
        className={cn(
          'bg-record transition-all duration-300',
          isRecording ? 'size-19 rounded-[14px]' : 'size-41 rounded-full'
        )}
      />
    </Button>
  )
}
