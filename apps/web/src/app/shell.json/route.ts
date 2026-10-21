import { songs } from '@/lib/catalog/songs.generated'

// The pages the service worker (public/sw.js) keeps for offline use beyond the tabs the start
// page links to: each Song's Song Creator, which Compose opens by client-side navigation, and the
// one page every Toot opens on (`/toots/toot/?id=`, matched without its query).

export const dynamic = 'force-static'

export function GET(): Response {
  return Response.json({ pages: [...songs.map(song => `/compose/${song.id}/`), '/toots/toot/'] })
}
