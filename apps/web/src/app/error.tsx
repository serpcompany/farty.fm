'use client'

import { ErrorScreen } from '@/components/pedos/error-screen'

export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  return <ErrorScreen error={error} />
}
