import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'
import { isProductionSite } from './src/lib/site'

const nextConfig: NextConfig = {
  trailingSlash: true,
  async headers() {
    // The microphone is the whole app; nothing else on the page may ask for it.
    const microphone = { key: 'Permissions-Policy', value: 'microphone=(self)' }
    const noindex = { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
    return [
      {
        source: '/:path*',
        headers: isProductionSite() ? [microphone] : [microphone, noindex]
      }
    ]
  }
}

export default nextConfig

initOpenNextCloudflareForDev()
