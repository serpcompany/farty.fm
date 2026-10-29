import { songs } from '@/lib/catalog/songs.generated'

export const dynamic = 'force-static'

export function GET(): Response {
  return Response.json({ pages: [...songs.map(song => `/compose/${song.id}/`), '/toots/toot/'] })
}
