import type { MetadataRoute } from 'next'
import { absoluteUrl, siteEnv, siteOrigin } from '@/lib/site'

// Outside Production nothing may be crawled. The Staging gate (worker.ts) serves this file without
// the password, so a crawler that reaches Staging still reads the disallow. Staging gives the site
// auditor Production's rules, so an audit of Staging, with the password, crawls what Production
// would. Each deployed environment lists the sitemap index on its own host.
const siteAuditor = 'AhrefsSiteAudit'

export default function robots(): MetadataRoute.Robots {
  const env = siteEnv()
  const origin = siteOrigin(env)
  const sitemap = origin ? { sitemap: absoluteUrl('/sitemap-index.xml', origin) } : {}
  if (env === 'production') return { rules: { userAgent: '*', allow: '/' }, ...sitemap }
  if (env === 'staging') {
    return {
      rules: [
        { userAgent: '*', disallow: '/' },
        { userAgent: siteAuditor, allow: '/' }
      ],
      ...sitemap
    }
  }
  return { rules: { userAgent: '*', disallow: '/' } }
}
