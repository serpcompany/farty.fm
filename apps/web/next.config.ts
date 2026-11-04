import { execFileSync } from 'node:child_process'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'
import { version } from './package.json'
import { siteEnv } from './src/lib/site'

/** The commit this build is from: CI's, else the checkout's, else none. */
function commit(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const sha = commit()

const nextConfig: NextConfig = {
  trailingSlash: true,
  // What every error report names (#126, src/lib/telemetry/): the release, as the version and
  // commit, and the environment the build is for.
  env: {
    PEDOS_RELEASE: sha ? `${version}+${sha.slice(0, 7)}` : version,
    PEDOS_ENVIRONMENT: siteEnv()
  },
  // Profile pages and shared links moved from `/u/<handle>/…` to `/@<handle>/…` (#382, ADR 0020,
  // ADR 0021). Links already sent keep working: each old path answers one 308 to its new one,
  // query included. The sources end in `/` because Next adds the trailing slash first. A shared
  // page's old link image, `opengraph-image`, is its `image/` now.
  async redirects() {
    return [
      {
        source: '/u/:handle/:kind(r|t)/:id/opengraph-image/',
        destination: '/@:handle/:kind/:id/image/',
        permanent: true
      },
      { source: '/u/:handle/:rest*/', destination: '/@:handle/:rest*/', permanent: true }
    ]
  },
  // Staging's noindex isn't here: the Staging gate (worker.ts) adds it after the cache, and only
  // to responses whose request didn't pass the password check.
  async headers() {
    // The microphone is the whole app; nothing else on the page may ask for it.
    const microphone = { key: 'Permissions-Policy', value: 'microphone=(self)' }
    return [{ source: '/:path*', headers: [microphone] }]
  }
}

export default nextConfig

initOpenNextCloudflareForDev()
