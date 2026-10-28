'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { reportError } from '@/lib/telemetry/errors'

export function ErrorScreen({ error }: { error: Error }) {
  useEffect(() => {
    reportError('uncaught-error', error)
  }, [error])

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>Reload Farty to carry on.</EmptyDescription>
      </EmptyHeader>
      <Button className="h-11 px-5 text-base" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </Empty>
  )
}
