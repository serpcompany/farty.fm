const ERROR_CODES = [
  'uncaught-error',
  'unhandled-rejection',
  'mic-denied',
  'mic-start-failed',
  'recording-save-failed',
  'analysis-failed',
  'toots-load-failed',
  'library-reload-failed',
  'library-open-failed',
  'toot-audio-missing',
  'toot-audio-read-failed',
  'toot-rename-failed',
  'toot-delete-failed',
  'toot-make-failed',
  'toot-save-failed',
  'library-connection-lost',
  'stale-build',
  'synthetic-handled'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const SCREENS = [
  'record',
  'recordings',
  'compose',
  'toots',
  'profile',
  'privacy',
  'support',
  'dev',
  'other'
] as const

type Screen = (typeof SCREENS)[number]

const ENVIRONMENTS = ['local', 'staging', 'production'] as const

export type Environment = (typeof ENVIRONMENTS)[number]

export type ErrorReport = {
  code: ErrorCode
  name?: string
  screen: Screen
  release: string
  environment: Environment
  delaySeconds: number
}

export const REPORT_MAX_BYTES = 1024

export const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60

const NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/
const RELEASE = /^[0-9A-Za-z.+-]{1,40}$/

const KEYS = new Set(['code', 'name', 'screen', 'release', 'environment', 'delaySeconds'])

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

export function errorName(value: unknown): string | undefined {
  return typeof value === 'string' && NAME.test(value) ? value : undefined
}

export function parseReport(value: unknown): ErrorReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).some(key => !KEYS.has(key))) return null
  const { code, name, screen, release, environment, delaySeconds } = fields
  if (!oneOf(ERROR_CODES, code) || !oneOf(SCREENS, screen) || !oneOf(ENVIRONMENTS, environment)) {
    return null
  }
  if (name !== undefined && errorName(name) === undefined) return null
  if (typeof release !== 'string' || !RELEASE.test(release)) return null
  if (
    typeof delaySeconds !== 'number' ||
    !Number.isInteger(delaySeconds) ||
    delaySeconds < 0 ||
    delaySeconds > MAX_DELAY_SECONDS
  ) {
    return null
  }
  return {
    code,
    ...(name === undefined ? {} : { name: name as string }),
    screen,
    release,
    environment,
    delaySeconds
  }
}

export function screenOf(pathname: string): Screen {
  const first = pathname.split('/')[1] ?? ''
  if (first === '') return 'record'
  return oneOf(SCREENS, first) && first !== 'record' && first !== 'other' ? first : 'other'
}
