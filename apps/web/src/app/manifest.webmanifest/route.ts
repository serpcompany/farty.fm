import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

const manifest: MetadataRoute.Manifest = {
  id: '/',
  name: 'Farty',
  short_name: 'Farty',
  description: 'Record your farts and find the note in each one.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
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
