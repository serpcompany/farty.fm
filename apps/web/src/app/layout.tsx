import type { Metadata, Viewport } from 'next'
import { AppShell } from '@/components/pedos/app-shell'
import { InstallPrompt } from '@/components/pedos/install-prompt'
import { PedosProvider } from '@/components/pedos/pedos-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pedos',
  description: 'Record your farts and find the note in each one.',
  appleWebApp: { title: 'Pedos', capable: true, statusBarStyle: 'default' }
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
        <PedosProvider>
          <AppShell>{children}</AppShell>
          <InstallPrompt />
        </PedosProvider>
      </body>
    </html>
  )
}
