import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { readDevMailbox } from '@/server/auth'

export const metadata: Metadata = {
  title: 'Dev mailbox · Pedos',
  robots: { index: false, follow: false }
}
export const dynamic = 'force-dynamic'

// The dev mailbox (#152): what a local run's email would have been, such as sign-in codes. It
// answers 404 anywhere but a local run (no SITE_ENV) on a local host, so never on Staging or
// Production (scripts/smoke.sh checks both).
export default async function DevMailPage() {
  const emails = await readDevMailbox((await headers()).get('host'))
  if (!emails) notFound()
  return (
    <article className="flex flex-col gap-3 px-4 pt-4 pb-6 text-sm leading-relaxed">
      <h1 className="text-3xl font-bold tracking-tight">Dev mailbox</h1>
      <p className="text-muted-foreground">
        Local runs never send email. Each one lands here instead, newest first, for a week.
      </p>
      {emails.length === 0 ? (
        <p>No email yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {emails.map(email => (
            <li key={email.id} className="rounded-lg border p-3" data-testid="dev-mail">
              <p className="font-semibold">{email.subject}</p>
              <p className="text-muted-foreground">
                To {email.to} · {email.capturedAt}
              </p>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{email.text}</pre>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}
