import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { siteEnv } from '@/lib/site'
import { TelemetryTriggers } from './triggers'

export const metadata: Metadata = {
  title: 'Error report test · Farty',
  robots: { index: false, follow: false }
}

export default function TelemetryTestPage() {
  if (siteEnv() === 'production') notFound()
  return (
    <article className="flex flex-col gap-3 px-4 pt-4 pb-6 text-sm leading-relaxed">
      <h1 className="text-3xl font-bold tracking-tight">Error report test</h1>
      <p className="text-muted-foreground">
        Each button sends an error report, unless sharing is off on Profile. Look for its code in
        the Worker&apos;s logs.
      </p>
      <TelemetryTriggers />
    </article>
  )
}
