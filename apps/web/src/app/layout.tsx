import type { Metadata, Viewport } from 'next'
import { AccountProvider } from '@/components/pedos/account-provider'
import { AppShell } from '@/components/pedos/app-shell'
import { DownloadQr } from '@/components/pedos/download-qr'
import { InstallPrompt } from '@/components/pedos/install-prompt'
import { PedosProvider } from '@/components/pedos/pedos-provider'
import { siteOrigin } from '@/lib/site'
import { welcomedKey } from '@/lib/welcomed'
import './globals.css'

const origin = siteOrigin()

export const metadata: Metadata = {
  title: 'Farty',
  description: 'Record your farts and find the note in each one.',
  appleWebApp: { title: 'Farty', capable: true, statusBarStyle: 'default' },
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

const markWelcomedBeforePaint = `try{localStorage.getItem(${JSON.stringify(welcomedKey)})!==null&&document.documentElement.setAttribute('data-welcomed','')}catch(e){}`

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script>{markWelcomedBeforePaint}</script>
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="min-h-full">
        <AccountProvider>
          <PedosProvider>
            <AppShell qrCode={<DownloadQr />}>{children}</AppShell>
            <InstallPrompt />
          </PedosProvider>
        </AccountProvider>
      </body>
    </html>
  )
}
