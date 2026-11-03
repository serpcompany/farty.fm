import type { MetadataRoute } from 'next'
import { absoluteUrl, siteEnv, siteOrigin } from '@/lib/site'

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
