import { absoluteUrl, servedOrigin } from './site'

const publicPages = ['/', '/privacy/', '/support/'] as const

const childSitemaps = ['/sitemap-pages.xml'] as const

const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>'
const sitemapNamespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

const loc = (path: string, origin: string) => `<loc>${escapeXml(absoluteUrl(path, origin))}</loc>`

function sitemapIndexXml(paths: readonly string[], origin: string): string {
  const items = paths.map(path => `<sitemap>${loc(path, origin)}</sitemap>`).join('')
  return `${xmlHead}<sitemapindex xmlns="${sitemapNamespace}">${items}</sitemapindex>`
}

function urlSetXml(paths: readonly string[], origin: string): string {
  const items = paths.map(path => `<url>${loc(path, origin)}</url>`).join('')
  return `${xmlHead}<urlset xmlns="${sitemapNamespace}">${items}</urlset>`
}

function xmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}

export function sitemapIndexResponse(request: Request): Response {
  return xmlResponse(sitemapIndexXml(childSitemaps, servedOrigin(request)))
}

export function pagesSitemapResponse(request: Request): Response {
  return xmlResponse(urlSetXml(publicPages, servedOrigin(request)))
}
