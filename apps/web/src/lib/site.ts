export type SiteEnv = 'local' | 'staging' | 'production'

/** Each deployed environment's own host, the one its canonicals, robots and sitemaps name. */
export const productionOrigin = 'https://pedos.app'
export const stagingOrigin = 'https://staging.pedos.app'

/** Which deployed environment this build is for. Builds bake it in, so one build serves one. */
export function siteEnv(): SiteEnv {
  const env = process.env.SITE_ENV
  return env === 'staging' || env === 'production' ? env : 'local'
}

/** The environment's own origin, or null for a local run, which has no host of its own. */
export function siteOrigin(env: SiteEnv = siteEnv()): string | null {
  if (env === 'production') return productionOrigin
  if (env === 'staging') return stagingOrigin
  return null
}

/** The origin a response names: the environment's own, or the request's on a local run. */
export function servedOrigin(request: Request): string {
  return siteOrigin() ?? new URL(request.url).origin
}

/** An absolute URL on `origin`. The home page is the origin itself, with no trailing slash. */
export function absoluteUrl(path: string, origin: string): string {
  return path === '/' ? origin : new URL(path, origin).toString()
}
