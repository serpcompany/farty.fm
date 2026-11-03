import type { Metadata, Viewport } from 'next'
import { AccountProvider } from '@/components/farty/account-provider'
import { AppShell } from '@/components/farty/app-shell'
import { DownloadQr } from '@/components/farty/download-qr'
import { FartyProvider } from '@/components/farty/farty-provider'
import { InstallPrompt } from '@/components/farty/install-prompt'
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
          <FartyProvider>
            <AppShell qrCode={<DownloadQr />}>{children}</AppShell>
            <InstallPrompt />
          </FartyProvider>
        </AccountProvider>
      </body>
    </html>
  )
}
