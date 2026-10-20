import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  trailingSlash: true,
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
