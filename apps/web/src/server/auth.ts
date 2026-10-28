import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { serveAuthRequest } from './auth-request'
import { readSessionUser, type SessionUser } from './auth-session'
import { type CapturedEmail, listCapturedEmails } from './dev-mailbox'
import { devMailboxStore } from './email'

export function handleAuthRequest(request: Request): Promise<Response> {
  return serveAuthRequest(request, getCloudflareContext().env)
}

export function getSessionUser(request: Request): Promise<SessionUser | null> {
  return readSessionUser(request, getCloudflareContext().env)
}

export async function readDevMailbox(host: string | null): Promise<CapturedEmail[] | null> {
  const store = devMailboxStore(getCloudflareContext().env, host)
  return store ? listCapturedEmails(store) : null
}
