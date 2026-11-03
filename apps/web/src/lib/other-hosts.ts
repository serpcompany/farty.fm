import { productionOrigin, stagingOrigin } from './site'
import { smokeTestHeader } from './staging-access'

const wwwHost = `www.${new URL(productionOrigin).hostname}`
const workersDevHost = /\.workers\.dev$/u
const servedAsTheyAre = /^\/(?:_next|\.well-known)(?:\/|$)/u
const file = /\/[^/]+\.\w+\/?$/u

export function canonicalPath(pathname: string): string {
  if (servedAsTheyAre.test(pathname)) return pathname
  if (file.test(pathname)) return pathname.replace(/\/$/u, '')
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

function canonicalOrigin(request: Request, hostname: string, siteEnv: string | undefined) {
  if (hostname === wwwHost) return productionOrigin
  if (!workersDevHost.test(hostname) || request.headers.has(smokeTestHeader)) return null
  return siteEnv === 'production' ? productionOrigin : stagingOrigin
}

export function otherHostResponse(request: Request, siteEnv: string | undefined): Response | null {
  const url = new URL(request.url)
  const origin = canonicalOrigin(request, url.hostname, siteEnv)
  if (!origin) return null
  return Response.redirect(`${origin}${canonicalPath(url.pathname)}${url.search}`, 308)
}
