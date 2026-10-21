import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { readSessionUser, type SessionUser, serveAuthRequest } from './auth-config'
import { type CapturedEmail, listCapturedEmails } from './dev-mailbox'
import { devMailboxStore } from './email'

export { AuthUnavailableError, type SessionUser } from './auth-config'

/**
 * Sign-in for a request, with this Worker's bindings (`auth-config.ts` holds the configuration and
 * the tests). Call these inside a route handler or server component, never at module scope.
 */

/** Serves `/api/auth/*` (src/app/api/auth/[...all]/route.ts). */
export function handleAuthRequest(request: Request): Promise<Response> {
  return serveAuthRequest(request, getCloudflareContext().env)
}

/**
 * The signed-in person, read from D1 on every call (no cookie cache): `{ id, email, marketingEmail }`
 * when signed in, null when signed out. Throws `AuthUnavailableError` (status 503) when sign-in
 * isn't set up here (logged as `auth_unavailable`): answer it 503, never 401.
 */
export function getSessionUser(request: Request): Promise<SessionUser | null> {
  return readSessionUser(request, getCloudflareContext().env)
}

/** The dev mailbox's emails, newest first, or null anywhere but a local run on a local host. */
export async function readDevMailbox(host: string | null): Promise<CapturedEmail[] | null> {
  const store = devMailboxStore(getCloudflareContext().env, host)
  return store ? listCapturedEmails(store) : null
}
