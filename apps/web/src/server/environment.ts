import { productionOrigin, stagingOrigin } from '@/lib/site'

/**
 * Which environment this Worker runs in, read per request from its runtime `SITE_ENV`
 * (wrangler.jsonc), not from the build: the CI journeys run a Staging build as a local Worker.
 *
 * - `deployed`: Staging or Production, with its own origin.
 * - `local`: no `SITE_ENV`, as wrangler.jsonc's top level, which is never deployed.
 * - `misconfigured`: any other value. Sign-in and email answer 503 rather than guess.
 */
export type Deployment =
  | { kind: 'deployed'; name: 'staging' | 'production'; origin: string }
  | { kind: 'local' }
  | { kind: 'misconfigured' }

export type DeploymentEnv = { SITE_ENV?: unknown }

export function deployment(env: DeploymentEnv): Deployment {
  if (env.SITE_ENV === undefined) return { kind: 'local' }
  if (env.SITE_ENV === 'staging') {
    return { kind: 'deployed', name: 'staging', origin: stagingOrigin }
  }
  if (env.SITE_ENV === 'production') {
    return { kind: 'deployed', name: 'production', origin: productionOrigin }
  }
  return { kind: 'misconfigured' }
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether a `Host` value (port included) names this machine: localhost, 127.0.0.1 or [::1]. */
export function isLocalHost(host: string | null): boolean {
  if (!host || !/^[\w.:[\]-]+$/.test(host) || !URL.canParse(`http://${host}`)) return false
  return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname)
}
