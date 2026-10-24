import { describe, expect, it } from 'vitest'

import { ORIGIN } from '@/test-support/library-api'

// Every route under `src/app/api/`, found from the files, except sign-in's own (`api/auth/`),
// the error reports' (`api/telemetry/`, which has no session by design and reads none; its own
// tests are in `telemetry/route.test.ts`) and Stripe's webhook (`api/stripe/`, checked by Stripe's
// signature instead; its tests are in `payments.workers.test.ts`): each method a route exports must answer 401 to a
// request with no session, before reading its body or params. A new route that skips
// `requireUser()` (`userRoute`) fails here.

const routeModules = import.meta.glob([
  './**/route.ts',
  '!./auth/**',
  '!./telemetry/route.ts',
  '!./stripe/**'
]) as Record<string, () => Promise<Record<string, unknown>>>
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const ID = '00000000-0000-4000-8000-000000000001'

/** `./recordings/[id]/audio/route.ts` → `/api/recordings/{id}/audio/`, and its params. */
function routeFor(file: string) {
  const segments = file
    .replace(/^\.\//, '')
    .replace(/\/?route\.ts$/, '')
    .split('/')
  const params: Record<string, string | string[]> = {}
  const path = segments
    .filter(Boolean)
    .map(segment => {
      const name = segment.match(/^\[(?:\.\.\.)?(.+)\]$/)?.[1]
      if (!name) return segment
      params[name] = segment.startsWith('[...') ? [ID] : ID
      return ID
    })
    .join('/')
  return { path: `/api/${path}${path ? '/' : ''}`, params }
}

describe('every API route outside api/auth/', () => {
  it('is found: the library, its items and their audio, and the account', () => {
    expect(Object.keys(routeModules).sort()).toEqual(
      expect.arrayContaining([
        './account/route.ts',
        './library/route.ts',
        './recordings/[id]/audio/route.ts',
        './recordings/[id]/route.ts',
        './toots/[id]/audio/route.ts',
        './toots/[id]/checkout/route.ts',
        './toots/[id]/payment/route.ts',
        './toots/[id]/route.ts',
        './dev/checkout/route.ts'
      ])
    )
  })

  for (const [file, load] of Object.entries(routeModules)) {
    it(`${file} answers 401, private and no-store, to every method without a session`, async () => {
      const module = await load()
      const { path, params } = routeFor(file)
      const methods = METHODS.filter(method => typeof module[method] === 'function')
      expect(methods.length).toBeGreaterThan(0)
      for (const method of methods) {
        const handler = module[method] as (r: Request, c: unknown) => Promise<Response>
        const body = method === 'GET' || method === 'HEAD' ? undefined : '{}'
        const request = new Request(`${ORIGIN}${path}`, {
          method,
          headers: { origin: ORIGIN, 'content-type': 'application/json' },
          body
        })
        const response = await handler(request, { params: Promise.resolve(params) })
        expect([method, response.status]).toEqual([method, 401])
        expect(response.headers.get('cache-control')).toBe('private, no-store')
      }
    })
  }
})
