import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { headersFile, securityHeaders } from './security-headers'

const staticAssetsHeaders = fileURLToPath(new URL('../../public/_headers', import.meta.url))

const policyOf = (nodeEnvironment: string) =>
  securityHeaders(nodeEnvironment).find(header => header.key === 'Content-Security-Policy')?.value

describe('security headers', () => {
  it('gives the static files Production serves without the Worker the same headers as pages', () => {
    expect(readFileSync(staticAssetsHeaders, 'utf8')).toBe(headersFile())
  })

  it("keeps the site out of every other site's frames", () => {
    expect(policyOf('production')).toContain("frame-ancestors 'none'")
    expect(securityHeaders('production')).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' })
  })

  it("allows the microphone's worklet, which loads from a blob, and Cloudflare's analytics beacon", () => {
    const policy = policyOf('production')
    expect(policy).toMatch(/script-src [^;]*blob:/)
    expect(policy).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/)
    expect(policy).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/)
  })

  it("allows Turnstile's script and its challenge frame, so the account step can send a code", () => {
    const policy = policyOf('production')
    expect(policy).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/)
    expect(policy).toMatch(/frame-src [^;]*https:\/\/challenges\.cloudflare\.com/)
  })

  it('leaves the policy off in next dev, whose hot reload needs eval', () => {
    expect(policyOf('development')).toBeUndefined()
    expect(securityHeaders('development')).toContainEqual({
      key: 'X-Content-Type-Options',
      value: 'nosniff'
    })
  })

  it('lets only the site itself ask for the microphone', () => {
    expect(securityHeaders('production')).toContainEqual({
      key: 'Permissions-Policy',
      value: 'microphone=(self), camera=(), geolocation=()'
    })
  })
})
