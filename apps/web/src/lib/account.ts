// A Pedos account, from the browser: the sign-in API (`src/server/auth-config.ts`: send a code,
// sign in with it, read the session, sign out) and the account routes (`/api/account/`). Every
// call is same-origin, so the browser sends the session cookie and its own Origin.

/** Who's using Pedos here, as far as this page knows. */
export type Account =
  /** Not known yet: the session is being read. */
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; id: string; email: string; marketingEmail: boolean }
  /**
   * Signed out, in a browser that was signed in: the session ended (it lasts 7 days without an
   * open) or its cookie went. This browser's copy is still the account's, so it stays.
   */
  | { status: 'expired' }
  /** The session couldn't be read: offline, or sign-in isn't set up here. */
  | { status: 'unreachable' }

type User = { id?: unknown; email?: unknown; marketingEmail?: unknown }

function signedIn(user: User): Account {
  return {
    status: 'signedIn',
    // Without one, this browser's library never syncs (`claimLibrary`).
    id: typeof user.id === 'string' ? user.id : '',
    email: String(user.email ?? ''),
    // News is on unless the account says it's off (the server's default, #150).
    marketingEmail: user.marketingEmail !== false
  }
}

/** How long opening Pedos waits for the session before it carries on without it. */
const SESSION_TIMEOUT_MS = 5000

/**
 * Reads the session. Each read also renews a session's cookie for another 7 days, once a day, so
 * Pedos calls it on every open (#155). Signed out in a browser that was signed in reads `expired`.
 */
export async function readSession(): Promise<Account> {
  // Not `AbortSignal.timeout`: a timer the tests can run.
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), SESSION_TIMEOUT_MS)
  try {
    const response = await fetch('/api/auth/get-session', {
      cache: 'no-store',
      signal: timeout.signal
    })
    if (!response.ok) return { status: 'unreachable' }
    const body = (await response.json()) as { user?: User } | null
    if (body?.user) return signedIn(body.user)
    return hadAccount() ? { status: 'expired' } : { status: 'signedOut' }
  } catch {
    return { status: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * localStorage: the id of the account this browser's Recordings and Toots are, so signed out
 * they're kept (`expired`) and they upload to no other account. Set when a signed-in browser
 * claims its library (`claimLibrary` in `library-sync.ts`), removed on Sign out, Delete account
 * and Clear this device. Without it, signed out is a guest. `1` (`legacyOwner`) is an account's
 * whose id wasn't kept, before #156.
 */
const accountKey = 'pedos.account'
export const legacyOwner = '1'

/** The account this browser's library is, or null for a guest's. Throws if storage is blocked. */
export function libraryOwner(): string | null {
  return localStorage.getItem(accountKey)
}

/** Makes this browser's library `accountId`'s. Throws if storage is blocked. */
export function setLibraryOwner(accountId: string): void {
  localStorage.setItem(accountKey, accountId)
}

function hadAccount(): boolean {
  try {
    return localStorage.getItem(accountKey) !== null
  } catch {
    return false
  }
}

/** Signed out or deleted: this browser is a guest's again. */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(accountKey)
  } catch {
    // Nothing was remembered.
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

/** The account step, open in this tab: where it was, so a reload comes back to it. */
export type StepDraft = { phase: 'email' | 'code'; email: string }

/**
 * sessionStorage: the open step's draft. A phone often drops the tab while the person reads the
 * code in Mail; coming back reloads Pedos, which opens the step where it was.
 */
const draftKey = 'pedos.accountStep.draft'

export function readStepDraft(): StepDraft | null {
  try {
    const draft = JSON.parse(
      sessionStorage.getItem(draftKey) ?? 'null'
    ) as Partial<StepDraft> | null
    if (!draft || (draft.phase !== 'email' && draft.phase !== 'code')) return null
    return { phase: draft.phase, email: String(draft.email ?? '') }
  } catch {
    return null
  }
}

export function saveStepDraft(draft: StepDraft): void {
  try {
    sessionStorage.setItem(draftKey, JSON.stringify(draft))
  } catch {
    // Nothing to keep it in: a reload starts the step afresh, from Profile.
  }
}

export function clearStepDraft(): void {
  try {
    sessionStorage.removeItem(draftKey)
  } catch {
    // Nothing was kept.
  }
}

/** sessionStorage: this tab has asked an `expired` browser to sign in again. */
const signInAgainKey = 'pedos.signInAgain'

/** Whether to ask an `expired` browser to sign in again: once a visit, remembering it did. */
export function takeSignInAgain(): boolean {
  try {
    if (sessionStorage.getItem(signInAgainKey) !== null) return false
    sessionStorage.setItem(signInAgainKey, '1')
    return true
  } catch {
    return false
  }
}
