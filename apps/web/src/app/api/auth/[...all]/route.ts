import { handleAuthRequest } from '@/server/auth'

// Sign-in (#152): only the four endpoints in src/server/auth-config.ts, and its Turnstile site
// key (#237); anything else is 404.
export const dynamic = 'force-dynamic'

export function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request)
}

export function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request)
}
