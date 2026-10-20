import { pagesSitemapResponse } from '@/lib/sitemap'

export function GET(request: Request): Response {
  return pagesSitemapResponse(request)
}
