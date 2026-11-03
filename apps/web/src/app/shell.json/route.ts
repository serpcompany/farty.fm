export const dynamic = 'force-static'

export function GET(): Response {
  return Response.json({ pages: ['/compose/song/', '/compose/pad/', '/toots/toot/'] })
}
