import { productionOrigin, stagingOrigin } from '@/lib/site'

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

export function isLocalHost(host: string | null): boolean {
  if (!host || !/^[\w.:[\]-]+$/.test(host) || !URL.canParse(`http://${host}`)) return false
  return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname)
}
