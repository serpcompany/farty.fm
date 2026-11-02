'use client'

import { Button } from '@/components/ui/button'

/**
 * The big red button that starts a take. It's the app's one signature control, so it's a stock
 * Button shaped through `className` and the `record` token. Once tapped, the Recording screen
 * covers it (`record-flow.tsx`): grey while the microphone gets ready, then red with its own Stop.
 */
export function RecordButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      aria-label="Record"
      data-testid="record-button"
      disabled={disabled}
      onClick={onClick}
      className="relative size-50 rounded-full border-[6px] border-muted p-0 hover:bg-transparent active:not-aria-[haspopup]:translate-y-0"
    >
      <span aria-hidden className="relative size-41 rounded-full bg-record" />
    </Button>
  )
}
