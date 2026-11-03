'use client'

import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/telemetry/errors'

class SyntheticCrash extends Error {
  name = 'SyntheticCrash'
}

class SyntheticError extends Error {
  name = 'SyntheticError'
}

function throwOutsideReact(error: Error): void {
  setTimeout(() => {
    throw error
  })
}

export function TelemetryTriggers() {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <Button
        variant="outline"
        className="h-11 text-base"
        onClick={() =>
          throwOutsideReact(
            new SyntheticCrash('A synthetic crash, with a seeded secret: test@example.com')
          )
        }
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
