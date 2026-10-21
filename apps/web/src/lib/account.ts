// A Pedos account, from the browser: the sign-in API (`src/server/auth-config.ts`: send a code,
// sign in with it, read the session, sign out) and the account routes (`/api/account/`). Every
// call is same-origin, so the browser sends the session cookie and its own Origin.

/** Who's using Pedos here, as far as this page knows. */
export type Account =
  /** Not known yet: the session is being read. */
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; email: string; marketingEmail: boolean }
  /** The session couldn't be read: offline, or sign-in isn't set up here. */
  | { status: 'unreachable' }

type User = { email?: unknown; marketingEmail?: unknown }

function signedIn(user: User): Account {
  return {
    status: 'signedIn',
    email: String(user.email ?? ''),
    // News is on unless the account says it's off (the server's default, #150).
    marketingEmail: user.marketingEmail !== false
  }
}

/** How long opening Pedos waits for the session before it carries on without it. */
const SESSION_TIMEOUT_MS = 5000

/**
 * Reads the session. Each read also renews a session's cookie for another 7 days, once a day, so
 * Pedos calls it on every open (#155).
 */
export async function readSession(): Promise<Account> {
  try {
    const response = await fetch('/api/auth/get-session', {
      cache: 'no-store',
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS)
    })
    if (!response.ok) return { status: 'unreachable' }
    const body = (await response.json()) as { user?: User } | null
    return body?.user ? signedIn(body.user) : { status: 'signedOut' }
  } catch {
    return { status: 'unreachable' }
  }
}

/** Why sending a code or signing in failed, as the account step says it. */
export type SignInProblem =
  | 'invalidEmail'
  | 'wrongCode'
  /** The code expired or was guessed wrong too often: a new one is needed. */
  | 'codeExpired'
  | 'tooManyTries'
  /** Sign-in codes can't be sent from here (a build without email). */
  | 'unavailable'
  /** Pedos couldn't be reached, or answered something unexpected. */
  | 'failed'

export type Result<T> = { ok: true; value: T } | { ok: false; problem: SignInProblem }

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

/** What a refused send or sign-in means, from its status and Better Auth's error code. */
export async function problemOf(response: Response): Promise<SignInProblem> {
  if (response.status === 429) return 'tooManyTries'
  if (response.status === 503) return 'unavailable'
  const code = await response
    .json()
    .then(body => (body as { code?: unknown } | null)?.code)
    .catch(() => undefined)
  switch (code) {
    case 'INVALID_EMAIL':
      return 'invalidEmail'
    case 'INVALID_OTP':
      return 'wrongCode'
    case 'OTP_EXPIRED':
    case 'TOO_MANY_ATTEMPTS':
      return 'codeExpired'
    default:
      return 'failed'
  }
}

/** Sends a 6-digit sign-in code to `email`. Signing in with it makes the account if it's new. */
export async function sendCode(email: string): Promise<Result<null>> {
  try {
    const response = await post('/api/auth/email-otp/send-verification-otp', {
      email: email.trim(),
      type: 'sign-in'
    })
    if (response.ok) return { ok: true, value: null }
    return { ok: false, problem: await problemOf(response) }
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

/** Signs in with the code sent to `email`, or makes the account. */
export async function signIn(email: string, code: string): Promise<Result<Account>> {
  try {
    const response = await post('/api/auth/sign-in/email-otp', { email: email.trim(), otp: code })
    if (!response.ok) return { ok: false, problem: await problemOf(response) }
    const body = (await response.json()) as { user?: User }
    return { ok: true, value: signedIn(body.user ?? { email }) }
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

/** Ends this browser's session. False when Pedos couldn't be reached. */
export async function signOut(): Promise<boolean> {
  try {
    return (await post('/api/auth/sign-out', {})).ok
  } catch {
    return false
  }
}

/** Deletes the account, its Recordings and Toots and their audio. False when it didn't. */
export async function deleteAccount(): Promise<boolean> {
  try {
    return (await fetch('/api/account/', { method: 'DELETE' })).ok
  } catch {
    return false
  }
}

/** Turns Pedos news by email on or off. False when it didn't change. */
export async function setMarketingEmail(on: boolean): Promise<boolean> {
  try {
    const response = await fetch('/api/account/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ marketingEmail: on })
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * When the account step offers itself (#150): after a Result's button, the first time; once more
 * after a saved Toot; then only from Profile. Remembered in `localStorage` as `pedos.accountStep`:
 * absent, `once` (offered once) or `done` (offered twice, or signed in).
 */
export type StepOffers = null | 'once' | 'done'
export type StepMoment = 'result' | 'toot'

const stepKey = 'pedos.accountStep'

/** Whether the step offers itself at `moment`, and what's remembered after. */
export function stepOffer(
  offers: StepOffers,
  moment: StepMoment
): { offer: boolean; next: StepOffers } {
  if (moment === 'result') {
    return offers === null ? { offer: true, next: 'once' } : { offer: false, next: offers }
  }
  return offers === 'done' ? { offer: false, next: 'done' } : { offer: true, next: 'done' }
}

/**
 * Whether the account step offers itself at `moment`, remembering that it did. With storage
 * blocked Pedos can't remember, so it never offers: only Profile does.
 */
export function takeStepOffer(moment: StepMoment): boolean {
  try {
    const stored = localStorage.getItem(stepKey)
    const offers: StepOffers = stored === 'once' || stored === 'done' ? stored : null
    const { offer, next } = stepOffer(offers, moment)
    if (next !== null) localStorage.setItem(stepKey, next)
    return offer
  } catch {
    return false
  }
}

/** After signing in, the step never offers itself again. */
export function stopStepOffers(): void {
  try {
    localStorage.setItem(stepKey, 'done')
  } catch {
    // Nothing to remember it in. Signed in, the step doesn't offer itself anyway.
  }
}
