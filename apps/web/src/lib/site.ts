export type SiteEnv = 'local' | 'staging' | 'production'

export const productionOrigin = 'https://farty.fm'
export const stagingOrigin = 'https://staging.farty.fm'

export function siteEnv(): SiteEnv {
  const env = process.env.SITE_ENV
  return env === 'staging' || env === 'production' ? env : 'local'
}

export function siteOrigin(env: SiteEnv = siteEnv()): string | null {
  if (env === 'production') return productionOrigin
  if (env === 'staging') return stagingOrigin
  return null
}

export function servedOrigin(request: Request): string {
  return siteOrigin() ?? new URL(request.url).origin
}

export function absoluteUrl(path: string, origin: string): string {
  return path === '/' ? origin : new URL(path, origin).toString()
}
