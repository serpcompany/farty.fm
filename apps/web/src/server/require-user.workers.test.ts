import { afterEach, describe, expect, it, vi } from 'vitest'

import { CF_RAY, ORIGIN, routeFailureLine, signUp } from '@/test-support/library-api'

import { userRoute } from './require-user'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('userRoute', () => {
  it('answers 500 when its handler throws, and logs the failure by name, code and cf-ray alone', async () => {
    const a = await signUp('A')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const route = userRoute(async user => {
      throw new RangeError(`D1_ERROR: no row for ${user.email}, token ${a.cookie}`)
    })
    const request = new Request(`${ORIGIN}/api/library/`, {
      headers: { cookie: a.cookie, 'cf-ray': CF_RAY }
    })

    const response = await route(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'server_error' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const lines = logged.mock.calls.map(([line]) => String(line))
    expect(lines.map(line => JSON.parse(line))).toEqual([
      routeFailureLine('user_route_failed', 'RangeError', 'GET', '/api/library/')
    ])
    expect(lines[0]).not.toMatch(/D1_ERROR|example\.test|test_session|stack/)
  })
})
