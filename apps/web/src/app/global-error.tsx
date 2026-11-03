'use client'

import { ErrorScreen } from '@/components/farty/error-screen'
import './globals.css'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>Farty</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <ErrorScreen error={error} />
      </body>
    </html>
  )
}
