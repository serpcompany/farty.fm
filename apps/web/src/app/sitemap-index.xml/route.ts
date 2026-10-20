import { sitemapIndexResponse } from '@/lib/sitemap'

export function GET(request: Request): Response {
  return sitemapIndexResponse(request)
}
