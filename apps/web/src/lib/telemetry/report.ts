/**
 * An error report: what the browser sends to `/api/telemetry/` and the route logs (#126). Shared
 * by both, so the browser's allowlist (`errors.ts`) and the route's check are the same one.
 *
 * A report is a stable code and a few bounded fields, never an error's message or stack, audio,
 * a Recording's or Toot's name, an email or anything else a person typed.
 */

/** Every code a report may carry. The route refuses any other. */
export const ERROR_CODES = [
  /** An error nothing caught (`window`'s `error` event), the synthetic crash included. */
  'uncaught-error',
  /** A rejected promise nothing handled. */
  'unhandled-rejection',
  'mic-denied',
  'mic-start-failed',
  /** A take's context stood still, and `startTake` tried once more by itself (#280). */
  'mic-start-retried',
  'recording-save-failed',
  /** Keeping where a Noise-like Recording is placed by ear failed (ADR 0015). */
  'recording-place-failed',
  /** Decoding, analyzing or saving the analysis of a Recording failed. */
  'analysis-failed',
  'toots-load-failed',
  /** Reloading the library after a sync reset failed. */
  'library-reload-failed',
  'toot-audio-missing',
  'toot-audio-read-failed',
  'toot-rename-failed',
  'toot-delete-failed',
  /** Song Creator's "Couldn't make this Toot". */
  'toot-make-failed',
  'toot-save-failed',
  /**
   * A read or write of the library failed on a lost IndexedDB connection, and again on a fresh
   * one (`withDb`, #222).
   */
  'library-connection-lost',
  /** A script of an older build failed to load, and the page reloaded, or would have (#222). */
  'stale-build',
  /** The Staging-only trigger's handled error (`/dev/telemetry/`). */
  'synthetic-handled'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** The screens a report may name: each path's first segment, never the rest (ids). */
export const SCREENS = [
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

export type Screen = (typeof SCREENS)[number]

export const ENVIRONMENTS = ['local', 'staging', 'production'] as const

export type Environment = (typeof ENVIRONMENTS)[number]

export type ErrorReport = {
  code: ErrorCode
  /** The error's type, such as `TypeError` or `NotAllowedError`. Absent when it isn't one. */
  name?: string
  screen: Screen
  /** The build's release: its version and commit (`next.config.ts`). */
  release: string
  /** The environment the build is for. */
  environment: Environment
  /** How long the report waited on the device before it was sent, in seconds. */
  delaySeconds: number
}

/** The most a report's body may be. A real one is about 200 bytes. */
export const REPORT_MAX_BYTES = 1024

/** A report's wait is capped at a week; an older one is dropped. */
export const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60

/** An error type's name: letters and digits, as `TypeError`. Anything else could be user input. */
const NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/
const RELEASE = /^[0-9A-Za-z.+-]{1,40}$/

const KEYS = new Set(['code', 'name', 'screen', 'release', 'environment', 'delaySeconds'])

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/** A valid error type name, or undefined. */
export function errorName(value: unknown): string | undefined {
  return typeof value === 'string' && NAME.test(value) ? value : undefined
}

/**
 * The report in `value`, or null when it isn't exactly one: any unknown key, missing field, or
 * field outside its bounds refuses the whole report.
 */
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

/** The screen a path is on: its first segment, or `other`. */
export function screenOf(pathname: string): Screen {
  const first = pathname.split('/')[1] ?? ''
  if (first === '') return 'record'
  return oneOf(SCREENS, first) && first !== 'record' && first !== 'other' ? first : 'other'
}
