// A Farty account, from the browser: the sign-in API (`src/server/auth-config.ts`: send a code,
// with a Turnstile token, sign in with it, read the session, sign out) and the account routes
// (`/api/account/`). Every call is same-origin, so the browser sends the session cookie and its own
// Origin.

/** Who's using Farty here, as far as this page knows. */
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

/** How long opening Farty waits for the session before it carries on without it. */
const SESSION_TIMEOUT_MS = 5000

/**
 * Reads the session. Each read also renews a session's cookie for another 7 days, once a day, so
 * Farty calls it on every open (#155). Signed out in a browser that was signed in reads `expired`.
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

/**
 * localStorage: the email of the account `pedos.account` is, lowercased, so the account step can
 * tell a sign-in to another account before it clears this browser's library (`unsavedBeforeSignIn`
 * in `library-sync.ts`).
 */
const accountEmailKey = 'pedos.account.email'

/** The email of the account this browser's library is, if known. Throws if storage is blocked. */
export function libraryOwnerEmail(): string | null {
  return localStorage.getItem(accountEmailKey)
}

/**
 * Makes this browser's library `accountId`'s, with its `email`. Without one, another account's
 * email is forgotten and the same account's kept. Throws if storage is blocked.
 */
export function setLibraryOwner(accountId: string, email = ''): void {
  const same = localStorage.getItem(accountKey) === accountId
  localStorage.setItem(accountKey, accountId)
  if (email) localStorage.setItem(accountEmailKey, email.trim().toLowerCase())
  else if (!same) localStorage.removeItem(accountEmailKey)
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
    localStorage.removeItem(accountEmailKey)
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
  /** Turnstile didn't pass the request: a new token is needed. */
  | 'notChecked'
  /** Sign-in codes can't be sent from here (a build without email or Turnstile's keys). */
  | 'unavailable'
  /** Farty couldn't be reached, or answered something unexpected. */
  | 'failed'

export type Result<T> = { ok: true; value: T } | { ok: false; problem: SignInProblem }

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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
    case 'MISSING_RESPONSE':
    case 'VERIFICATION_FAILED':
      return 'notChecked'
    default:
      return 'failed'
  }
}

/** The Turnstile site key for this environment's widget, read at runtime (#237). */
export async function turnstileSiteKey(): Promise<Result<string>> {
  try {
    const response = await fetch('/api/auth/turnstile', { cache: 'no-store' })
    if (!response.ok) return { ok: false, problem: await problemOf(response) }
    const { siteKey } = (await response.json()) as { siteKey?: unknown }
    if (typeof siteKey !== 'string' || siteKey === '') return { ok: false, problem: 'failed' }
    return { ok: true, value: siteKey }
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

/**
 * Sends a 6-digit sign-in code to `email`, with the Turnstile `token` that says a person asked
 * (#237). Each token works once. Signing in with the code makes the account if it's new.
 */
export async function sendCode(email: string, token: string): Promise<Result<null>> {
  try {
    const response = await post(
      '/api/auth/email-otp/send-verification-otp',
      { email: email.trim(), type: 'sign-in' },
      { 'x-captcha-response': token }
    )
    if (!response.ok) return { ok: false, problem: await problemOf(response) }
    noteCodeSent()
    return { ok: true, value: null }
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

/**
 * localStorage: when this browser last had a sign-in code sent, in ms since the epoch. While the
 * code works, a guest's new visit keeps their farts (`clearsOnOpen` in `visit.ts`): a home-screen
 * app that iOS ended while they read the code may open again as a new visit.
 */
const codeSentKey = 'pedos.codeSent'
/** How long a sign-in code works: `SIGN_IN_CODE_MINUTES` in `src/server/email.ts`. */
export const CODE_WORKS_MS = 10 * 60_000

function noteCodeSent(): void {
  try {
    localStorage.setItem(codeSentKey, String(Date.now()))
  } catch {
    // Nothing to remember it in: a new visit clears as usual.
  }
}

/** Whether a sign-in code sent from this browser still works. */
export function codeSentLately(now = Date.now()): boolean {
  try {
    const sent = Number(localStorage.getItem(codeSentKey))
    return sent > 0 && now >= sent && now - sent < CODE_WORKS_MS
  } catch {
    return false
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

/** Ends this browser's session. False when Farty couldn't be reached. */
export async function signOut(): Promise<boolean> {
  try {
    return (await post('/api/auth/sign-out', {})).ok
  } catch {
    return false
  }
}

/**
 * How a change to the account went: done; refused, because the session is another account's now
 * (a sign-in in another tab); or it didn't happen.
 */
export type AccountChange = 'done' | 'otherAccount' | 'failed'

/**
 * Sends a change to `/api/account/` as `accountId`, the account this page shows, in the header
 * the library's requests name it in too (`LIBRARY_HEADER` on the server): the server refuses it
 * when the session is another account's, so a page left open never deletes or changes it.
 */
async function changeAccount(accountId: string, init: RequestInit): Promise<AccountChange> {
  try {
    const headers = new Headers(init.headers)
    headers.set('x-pedos-library', accountId)
    const response = await fetch('/api/account/', { ...init, headers })
    if (response.ok) return 'done'
    if (response.status !== 409) return 'failed'
    const error = await response
      .json()
      .then(body => (body as { error?: unknown } | null)?.error)
      .catch(() => undefined)
    return error === 'wrong_account' ? 'otherAccount' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Deletes `accountId`'s account, its Recordings and Toots and their audio. */
export function deleteAccount(accountId: string): Promise<AccountChange> {
  return changeAccount(accountId, { method: 'DELETE' })
}

/** Turns Farty news by email on or off for `accountId`'s account. */
export function setMarketingEmail(on: boolean, accountId: string): Promise<AccountChange> {
  return changeAccount(accountId, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marketingEmail: on })
  })
}

/**
 * When the account step offers itself (#150): after a Result's button, the first time, and once
 * more for a guest from before #237 (`offerStepAgain`); then only from Profile, and at Save
 * (#237). Remembered in `localStorage` as `pedos.accountStep`: absent, `once` (offered) or `done`
 * (signed in, or offered twice before #237, after a saved Toot).
 */
const stepKey = 'pedos.accountStep'

/**
 * Whether the account step offers itself at a Result's button, remembering that it did. With
 * storage blocked Farty can't remember, so it never offers: only Profile and Save do.
 */
export function takeStepOffer(): boolean {
  try {
    if (localStorage.getItem(stepKey) !== null) return false
    localStorage.setItem(stepKey, 'once')
    return true
  } catch {
    return false
  }
}

/**
 * The step offers itself once more, at the next Result: for a guest from before #237, who was
 * told their Recordings stay (`noteKept` in `visit.ts`).
 */
export function offerStepAgain(): void {
  try {
    localStorage.removeItem(stepKey)
  } catch {
    // Nothing to forget: with storage blocked, the step never offers itself.
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
 * code in Mail; coming back reloads Farty, which opens the step where it was.
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
