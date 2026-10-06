/** Which deployed environment this build is for. Builds bake it in, so one build serves one. */
export function siteEnv(): 'local' | 'staging' | 'production' {
  const env = process.env.SITE_ENV
  return env === 'staging' || env === 'production' ? env : 'local'
}

export function isProductionSite(): boolean {
  return siteEnv() === 'production'
}
