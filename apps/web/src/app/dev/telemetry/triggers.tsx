'use client'

import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/telemetry/errors'

/** Thrown where nothing catches it: an `uncaught-error` report named `SyntheticCrash`. */
class SyntheticCrash extends Error {
  name = 'SyntheticCrash'
}

/** Caught and reported: a `synthetic-handled` report named `SyntheticError`. */
class SyntheticError extends Error {
  name = 'SyntheticError'
}

export function TelemetryTriggers() {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <Button
        variant="outline"
        className="h-11 text-base"
        onClick={() => {
          // Outside React's handler, so nothing catches it: as a real crash.
          setTimeout(() => {
            throw new SyntheticCrash('A synthetic crash, with a seeded secret: test@example.com')
          })
        }}
      >
        Crash
      </Button>
      <Button
        variant="outline"
        className="h-11 text-base"
        onClick={() =>
          reportError(
            'synthetic-handled',
            new SyntheticError('A handled error, with a seeded secret: test@example.com')
          )
        }
      >
        Report a handled error
      </Button>
    </div>
  )
}
