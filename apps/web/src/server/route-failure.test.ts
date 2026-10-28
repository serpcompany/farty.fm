import { describe, expect, it, vi } from 'vitest'

import { logRouteFailure } from './route-failure'

function logged(error: unknown, headers: Record<string, string> = {}) {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const request = new Request('https://farty.fm/api/toots/x/?token=secret', {
    method: 'DELETE',
    headers
  })
  logRouteFailure('user_route_failed', error, request)
  const lines = spy.mock.calls.map(([line]) => String(line))
  spy.mockRestore()
  expect(lines).toHaveLength(1)
  return lines[0]
}

describe('logRouteFailure', () => {
  it('logs one JSON line: the code, the error’s name, the method, the path and the cf-ray', () => {
    const error = new TypeError('fan@example.com has session abc.def')
    const line = logged(error, { 'cf-ray': '8f3a1c2b4d5e6f70-SJC', cookie: 'pedos.session=abc' })
    expect(JSON.parse(line)).toEqual({
      event: 'route_failed',
      code: 'user_route_failed',
      name: 'TypeError',
      method: 'DELETE',
      path: '/api/toots/x/',
      ray: '8f3a1c2b4d5e6f70-SJC'
    })
    expect(line).not.toMatch(/fan@example|abc|secret/)
  })

  it('logs no name it can’t trust, and no cf-ray that isn’t one', () => {
    for (const error of ['a string', null, { name: 'fan@example.com' }, { name: 42 }]) {
      expect(JSON.parse(logged(error))).toMatchObject({ name: null, ray: null })
    }
    expect(JSON.parse(logged(new Error('x'), { 'cf-ray': 'fan@example.com' }))).toMatchObject({
      name: 'Error',
      ray: null
    })
  })
})
