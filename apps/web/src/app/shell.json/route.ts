// The pages the service worker (public/sw.js) keeps for offline use beyond the tabs the start
// page links to, which Compose and Toots open by client-side navigation: the one Song page that
// answers for every Song offline (`/compose/song/`, #322) in place of a page each, the Sound Pad,
// and the one page every Toot opens on (`/toots/toot/?id=`, matched without its query).

export const dynamic = 'force-static'

export function GET(): Response {
  return Response.json({ pages: ['/compose/song/', '/compose/pad/', '/toots/toot/'] })
}
