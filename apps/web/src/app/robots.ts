import type { MetadataRoute } from 'next'
import { isProductionSite } from '@/lib/site'

// Outside Production nothing may be crawled. The Staging gate (worker.ts) serves this file without
// the password, so a crawler that reaches Staging still reads the disallow. #113 adds the auditor
// group, Production's rules and the Sitemap: lines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: isProductionSite() ? { userAgent: '*', allow: '/' } : { userAgent: '*', disallow: '/' }
  }
}
