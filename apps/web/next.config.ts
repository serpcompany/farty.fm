import { execFileSync } from 'node:child_process'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'
import { version } from './package.json'
import { securityHeaders } from './src/lib/security-headers'
import { siteEnv } from './src/lib/site'

function buildCommit(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const sha = buildCommit()

const nextConfig: NextConfig = {
  trailingSlash: true,
  poweredByHeader: false,
  env: {
    PEDOS_RELEASE: sha ? `${version}+${sha.slice(0, 7)}` : version,
    PEDOS_ENVIRONMENT: siteEnv()
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV) }]
  }
}

export default nextConfig

initOpenNextCloudflareForDev()
