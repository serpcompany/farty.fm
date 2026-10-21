import { productionOrigin, stagingOrigin } from './site'
import { smokeTestHeader } from './staging-access'

// Every environment answers on one host. `www` and the `*.workers.dev` hosts send a request to it
// in one 308, path, trailing slash and query included, so each page has one URL. The Worker entry
// (worker.ts) runs this before the Staging gate. Copied from zenbujapanese-monorepo's
// src/lib/other-hosts.ts.

const wwwHost = 'www.pedos.app'
const workersDevHost = /\.workers\.dev$/u
// Next's own paths, which it serves as they are.
const servedAsTheyAre = /^\/(?:_next|\.well-known)(?:\/|$)/u
// A file: its last segment has an extension. Next serves it without a trailing slash.
const file = /\/[^/]+\.\w+\/?$/u

/** The path as Next serves it (`trailingSlash: true`), so the redirect needs no second hop. */
export function canonicalPath(pathname: string): string {
  if (servedAsTheyAre.test(pathname)) return pathname
  if (file.test(pathname)) return pathname.replace(/\/$/u, '')
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

function canonicalOrigin(request: Request, hostname: string, siteEnv: string | undefined) {
  if (hostname === wwwHost) return productionOrigin
  // The smoke test reaches each deploy on its workers.dev host before the branded host serves it.
  if (!workersDevHost.test(hostname) || request.headers.has(smokeTestHeader)) return null
  return siteEnv === 'production' ? productionOrigin : stagingOrigin
}

/** A 308 to the environment's own host, or null when the request is already on it. */
export function otherHostResponse(request: Request, siteEnv: string | undefined): Response | null {
  const url = new URL(request.url)
  const origin = canonicalOrigin(request, url.hostname, siteEnv)
  if (!origin) return null
  return Response.redirect(`${origin}${canonicalPath(url.pathname)}${url.search}`, 308)
}
