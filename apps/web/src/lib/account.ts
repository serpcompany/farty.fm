import { withinTimeout } from './timeout'

export type Account =
  | { status: 'checking' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; id: string; email: string; marketingEmail: boolean }
  | { status: 'expired' }
  | { status: 'unreachable' }

type User = { id?: unknown; email?: unknown; marketingEmail?: unknown }

function signedIn(user: User): Account {
  return {
    status: 'signedIn',
    id: typeof user.id === 'string' ? user.id : '',
    email: String(user.email ?? ''),
    marketingEmail: user.marketingEmail !== false
  }
}

const SESSION_TIMEOUT_MS = 5000

export async function readSession(): Promise<Account> {
  try {
    return await withinTimeout(SESSION_TIMEOUT_MS, async (signal): Promise<Account> => {
      const response = await fetch('/api/auth/get-session', { cache: 'no-store', signal })
      if (!response.ok) return { status: 'unreachable' }
      const body = (await response.json()) as { user?: User } | null
      if (body?.user) return signedIn(body.user)
      return hadAccount() ? { status: 'expired' } : { status: 'signedOut' }
    })
  } catch {
    return { status: 'unreachable' }
  }
}

const accountKey = 'pedos.account'
export const legacyOwner = '1'

export function libraryOwner(): string | null {
  return localStorage.getItem(accountKey)
}

export function readableLibraryOwner(): string | null | undefined {
  try {
    return libraryOwner()
  } catch {
    return undefined
  }
}

const accountEmailKey = 'pedos.account.email'

export function readableLibraryOwnerEmail(): string | null {
  try {
    return localStorage.getItem(accountEmailKey)
  } catch {
    return null
  }
}

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

export function forgetAccount(): void {
  try {
    localStorage.removeItem(accountKey)
    localStorage.removeItem(accountEmailKey)
  } catch {}
}

export type SignInProblem =
  | 'invalidEmail'
  | 'wrongCode'
  | 'codeExpired'
  | 'tooManyTries'
  | 'unavailable'
  | 'failed'

export type Result<T> = { ok: true; value: T } | { ok: false; problem: SignInProblem }

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

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

export async function signOut(): Promise<boolean> {
  try {
    return (await post('/api/auth/sign-out', {})).ok
  } catch {
    return false
  }
}

export type AccountChange = 'done' | 'otherAccount' | 'failed'

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

export function deleteAccount(accountId: string): Promise<AccountChange> {
  return changeAccount(accountId, { method: 'DELETE' })
}

export function setMarketingEmail(on: boolean, accountId: string): Promise<AccountChange> {
  return changeAccount(accountId, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marketingEmail: on })
  })
}

export type StepOffers = null | 'once' | 'done'
export type StepMoment = 'result' | 'toot'

const stepKey = 'pedos.accountStep'

export function stepOffer(
  offers: StepOffers,
  moment: StepMoment
): { offer: boolean; next: StepOffers } {
  if (moment === 'result') {
    return offers === null ? { offer: true, next: 'once' } : { offer: false, next: offers }
  }
  return offers === 'done' ? { offer: false, next: 'done' } : { offer: true, next: 'done' }
}

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

export function stopStepOffers(): void {
  try {
    localStorage.setItem(stepKey, 'done')
  } catch {}
}

export type StepDraft = { phase: 'email' | 'code'; email: string }

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
  } catch {}
}

export function clearStepDraft(): void {
  try {
    sessionStorage.removeItem(draftKey)
  } catch {}
}

const signInAgainKey = 'pedos.signInAgain'

export function takeSignInAgain(): boolean {
  try {
    if (sessionStorage.getItem(signInAgainKey) !== null) return false
    sessionStorage.setItem(signInAgainKey, '1')
    return true
  } catch {
    return false
  }
}
