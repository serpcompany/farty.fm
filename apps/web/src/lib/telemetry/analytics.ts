import { type SiteEnv, siteEnv } from '@/lib/site'

/**
 * Cloudflare Web Analytics (#126): cookieless visit counts, in Production only, kept apart from
 * error reports (`errors.ts`). Each environment's site token, public by design, so it's config.
 * An empty token renders no beacon: Staging and local runs have none.
 */
export const WEB_ANALYTICS_TOKENS: Record<SiteEnv, string> = {
  local: '',
  staging: '',
  // The pedos.app site, set up for manual install (no automatic injection).
  production: 'e5c178acd813418c8a128caf531d2b03'
}

/** This build's Web Analytics token, or null when it has no beacon. */
export function webAnalyticsToken(env: SiteEnv = siteEnv()): string | null {
  return WEB_ANALYTICS_TOKENS[env] || null
}
