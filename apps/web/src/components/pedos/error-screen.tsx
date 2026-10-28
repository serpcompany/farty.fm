'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/telemetry/errors'
import { ReloadScreen } from './reload-screen'

export function ErrorScreen({ error }: { error: Error }) {
  useEffect(() => {
    reportError('uncaught-error', error)
  }, [error])

  return <ReloadScreen title="Something went wrong" description="Reload Farty to carry on." />
}
