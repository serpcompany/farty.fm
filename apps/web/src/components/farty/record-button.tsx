'use client'

import { Button } from '@/components/ui/button'

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
