'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { MAX_PERFORMANCE_SECONDS } from '@/lib/performance'
import { formattedTootLength } from '@/lib/toot'
import { cn } from '@/lib/utils'
import { PadTootLayout } from './pad-toot-layout'
import type { PadTake } from './use-pad-take'

export function PadTakeControls({ take, disabled }: { take: PadTake; disabled: boolean }) {
  const { phase } = take
  if (phase.kind === 'idle' || phase.kind === 'recording') {
    const recording = phase.kind === 'recording'
    const started = recording && phase.firstTapAt !== null
    const lost = phase.kind === 'idle' && phase.lost === true
    return (
      <div className="flex flex-col gap-3">
        {lost && (
          <output className="block text-sm text-muted-foreground" data-testid="pad-take-lost">
            Your payment went through, but this take couldn't be made again here.{' '}
            <Link href="/support/" className="underline">
              Contact support
            </Link>{' '}
            for a refund.
          </output>
        )}
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label={recording ? 'Stop recording' : 'Record'}
            data-testid={recording ? 'pad-take-stop' : 'pad-take-record'}
            disabled={disabled}
            className="flex size-14 shrink-0 items-center justify-center rounded-full border-4 border-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            onClick={recording ? take.stop : take.record}
          >
            <span
              aria-hidden
              className={cn(
                'bg-record transition-all duration-300',
                recording ? 'size-5 rounded-[5px]' : 'size-10 rounded-full'
              )}
            />
          </button>
          <div className="min-w-0" aria-live="polite">
            <p className="font-semibold tabular-nums" data-testid="pad-take-state">
              {started
                ? `${formattedTootLength(Math.floor(take.elapsed))} of ${formattedTootLength(MAX_PERFORMANCE_SECONDS)}`
                : recording
                  ? 'Recording'
                  : 'Record'}
            </p>
            <p className="text-sm text-muted-foreground">
              {started
                ? 'Tap Stop to hear it.'
                : recording
                  ? 'It starts at your first tap.'
                  : `Play up to ${MAX_PERFORMANCE_SECONDS} s, then hear it back.`}
            </p>
          </div>
        </div>
      </div>
    )
  }
  if (phase.kind === 'making') {
    return (
      <div className="flex items-center gap-4 text-muted-foreground">
        <span className="flex size-14 shrink-0 items-center justify-center">
          <Spinner className="size-6" />
        </span>
        <p>Making your Toot…</p>
      </div>
    )
  }
  if (phase.kind === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground">Couldn't make this Toot.</p>
        <div className="flex gap-3">
          <Button variant="outline" className="h-11 px-5 text-base" onClick={take.retry}>
            Try again
          </Button>
          <Button variant="ghost" className="h-11 px-5 text-base" onClick={take.record}>
            Record again
          </Button>
        </div>
      </div>
    )
  }
  return (
    <PadTootLayout toot={phase.draft}>
      <Button
        variant="outline"
        className="mt-2 h-9 px-3"
        data-testid="pad-take-again"
        onClick={take.record}
      >
        Record again
      </Button>
    </PadTootLayout>
  )
}
