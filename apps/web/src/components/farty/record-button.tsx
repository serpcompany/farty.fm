'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function RecordButton({
  isRecording,
  starting = false,
  disabled,
  onClick
}: {
  isRecording: boolean
  starting?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={isRecording ? 'Stop' : starting ? 'Starting…' : 'Record'}
      data-testid={isRecording ? 'stop-button' : 'record-button'}
      disabled={disabled || starting}
      onClick={onClick}
      className={cn(
        'relative size-50 rounded-full border-[6px] border-muted p-0 hover:bg-transparent active:not-aria-[haspopup]:translate-y-0',
        starting && 'disabled:opacity-100'
      )}
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
          'flex items-center justify-center bg-record text-lg font-semibold text-record-foreground transition-all duration-300',
          isRecording ? 'size-19 rounded-[14px]' : 'size-41 rounded-full'
        )}
      >
        {starting && 'Starting…'}
      </span>
    </Button>
  )
}
