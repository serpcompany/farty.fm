'use client'

import { ErrorScreen } from '@/components/farty/error-screen'

export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  return <ErrorScreen error={error} />
}
