import type { Metadata, Viewport } from 'next'
import { AccountProvider } from '@/components/pedos/account-provider'
import { AppShell } from '@/components/pedos/app-shell'
import { InstallPrompt } from '@/components/pedos/install-prompt'
import { PedosProvider } from '@/components/pedos/pedos-provider'
import { siteOrigin } from '@/lib/site'
import './globals.css'

const origin = siteOrigin()

export const metadata: Metadata = {
  title: 'Farty',
  description: 'Record your farts and find the note in each one.',
  appleWebApp: { title: 'Farty', capable: true, statusBarStyle: 'default' },
  // Each page's canonical is its own path on the environment's host. A local run has no host, so
  // no canonical. The home page writes its own (page.tsx): Next would add a trailing slash.
  ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: './' } } : {})
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' }
  ]
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* With credentials, so Chrome can fetch it behind the Staging password (#123). */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="min-h-full">
        <AccountProvider>
          <PedosProvider>
            <AppShell>{children}</AppShell>
            <InstallPrompt />
          </PedosProvider>
        </AccountProvider>
      </body>
    </html>
  )
}
