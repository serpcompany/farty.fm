import { errorName } from '@/lib/telemetry/report'

type RouteFailure = 'user_route_failed' | 'stripe_webhook_failed'

const CF_RAY = /^[0-9A-Za-z-]{1,64}$/

function nameOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  return errorName(Reflect.get(error, 'name')) ?? null
}

export function logRouteFailure(code: RouteFailure, error: unknown, request: Request): void {
  const ray = request.headers.get('cf-ray')
  const fields = {
    event: 'route_failed',
    code,
    name: nameOf(error),
    method: request.method,
    path: new URL(request.url).pathname,
    ray: ray !== null && CF_RAY.test(ray) ? ray : null
  }
  console.error(JSON.stringify(fields))
}
