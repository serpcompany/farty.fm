import { vi } from 'vitest'

import { TURNSTILE_TEST_SECRET_KEY } from '@/server/auth-config'

// Turnstile in the node and workers tests: siteverify answers as Cloudflare does for its published
// always-pass test secret, so nothing reaches Cloudflare. The journeys (`e2e/`) use the real one.

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** The token Cloudflare's test site keys give, which only its test secrets accept. */
export const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const urlOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input))

/**
 * Answers siteverify as Cloudflare answers the always-pass test secret: success for the test
 * token only. Every other request goes out as usual. Undone by `vi.restoreAllMocks()`.
 */
export function fakeSiteverify() {
  const real = globalThis.fetch
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (urlOf(input) !== SITEVERIFY) return real(input, init)
    const { secret, response } = JSON.parse(String(init?.body)) as Record<string, unknown>
    const success = secret === TURNSTILE_TEST_SECRET_KEY && response === TEST_TOKEN
    return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] })
  })
}

/** What each siteverify call sent, while `fakeSiteverify` answers. */
export function siteverifyCalls(): Record<string, unknown>[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => urlOf(input) === SITEVERIFY)
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}
