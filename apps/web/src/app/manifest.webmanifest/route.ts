import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

/**
 * The web app manifest. It's a route handler, not `manifest.ts`, so that `layout.tsx` can link it
 * with `crossorigin="use-credentials"`: Chrome fetches a manifest without credentials otherwise,
 * so behind the Staging password (#123) it would get a 401. Next adds that attribute to its own
 * manifest link only on Vercel previews.
 */
const manifest: MetadataRoute.Manifest = {
  id: '/',
  name: 'Pedos',
  short_name: 'Pedos',
  description: 'Record your farts and find the note in each one.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  // The iPhone app is portrait only.
  orientation: 'portrait',
  // The iPhone app's launch screen: the system background.
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [
    { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}

export function GET(): Response {
  return Response.json(manifest, { headers: { 'Content-Type': 'application/manifest+json' } })
}
