import { vi } from 'vitest'

import { TURNSTILE_TEST_SECRET_KEY } from '@/server/auth-settings'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const urlOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input))

export function fakeSiteverify() {
  const real = globalThis.fetch
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (urlOf(input) !== SITEVERIFY) return real(input, init)
    const { secret, response } = JSON.parse(String(init?.body)) as Record<string, unknown>
    const success = secret === TURNSTILE_TEST_SECRET_KEY && response === TEST_TOKEN
    return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] })
  })
}

export function siteverifyCalls(): Record<string, unknown>[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => urlOf(input) === SITEVERIFY)
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}
