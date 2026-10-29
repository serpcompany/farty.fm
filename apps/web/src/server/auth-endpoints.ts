export const AUTH_BASE_PATH = '/api/auth'
export const SEND_CODE_ENDPOINT = '/email-otp/send-verification-otp'
export const SIGN_IN_ENDPOINT = '/sign-in/email-otp'
export const GET_SESSION_ENDPOINT = '/get-session'
export const SIGN_OUT_ENDPOINT = '/sign-out'
export const TURNSTILE_ENDPOINT = '/turnstile'

export const AUTH_ENDPOINTS: readonly { method: 'GET' | 'POST'; path: string }[] = [
  { method: 'POST', path: SEND_CODE_ENDPOINT },
  { method: 'POST', path: SIGN_IN_ENDPOINT },
  { method: 'GET', path: GET_SESSION_ENDPOINT },
  { method: 'POST', path: SIGN_OUT_ENDPOINT }
]

function endpointPath(pathname: string): string | null {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return null
  const path = pathname.slice(AUTH_BASE_PATH.length)
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

export function servedEndpoint(method: string, pathname: string): string | null {
  const path = endpointPath(pathname)
  const served = AUTH_ENDPOINTS.some(
    endpoint => endpoint.method === method && endpoint.path === path
  )
  return served ? path : null
}

export function isTurnstileKeyRequest(method: string, pathname: string): boolean {
  return method === 'GET' && endpointPath(pathname) === TURNSTILE_ENDPOINT
}
