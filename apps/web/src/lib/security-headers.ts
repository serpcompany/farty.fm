const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' blob: https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  'frame-src https://challenges.cloudflare.com',
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ')

export interface Header {
  key: string
  value: string
}

const everywhere: Header[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' }
]

const policy: Header = { key: 'Content-Security-Policy', value: contentSecurityPolicy }

export function securityHeaders(nodeEnvironment: string | undefined): Header[] {
  return nodeEnvironment === 'development' ? everywhere : [policy, ...everywhere]
}

export function headersFile(): string {
  const lines = securityHeaders('production').map(({ key, value }) => `  ${key}: ${value}`)
  return ['/*', ...lines, ''].join('\n')
}
