import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendCode, signIn } from '@/lib/account'
import { button, closeScreens, show, tap, type } from '@/test-support/screen'
import { AccountStep } from './account-step'

vi.mock('@/lib/account', () => ({
  readStepDraft: () => null,
  saveStepDraft: vi.fn(),
  sendCode: vi.fn(),
  signIn: vi.fn()
}))
vi.mock('@/lib/library-sync', () => ({ unsavedBeforeSignIn: async () => 0 }))
vi.mock('./account-provider', () => ({
  useAccount: () => ({
    stepOpen: true,
    account: { status: 'signedOut' },
    skipStep: vi.fn(),
    finishSignIn: vi.fn()
  })
}))

const field = (id: string) => document.body.querySelector<HTMLInputElement>(`#${id}`)
const problem = () => document.body.querySelector('[role="alert"]')?.textContent

async function sendCodeTo(email: string) {
  const emailField = field('account-email')
  if (!emailField) throw new Error('No Email field')
  await type(emailField, email)
  await tap(button('Send code'))
}

beforeEach(() => vi.clearAllMocks())

afterEach(closeScreens)

describe('the account step', () => {
  it.each([
    ['invalidEmail', 'Enter a valid email address.'],
    ['tooManyTries', 'Too many tries. Wait a few minutes, then try again.'],
    ['unavailable', "Accounts aren't available right now."],
    ['failed', "Couldn't reach Farty. Check your connection and try again."]
  ] as const)('says what went wrong in words (%s)', async (code, words) => {
    vi.mocked(sendCode).mockResolvedValue({ ok: false, problem: code })
    await show(<AccountStep />)
    await sendCodeTo('farter@example.com')

    expect(problem()).toBe(words)
    expect(field('account-email')).not.toBeNull()
  })

  it('goes back to the Email field when the code no longer works', async () => {
    vi.mocked(sendCode).mockResolvedValue({ ok: true, value: null })
    vi.mocked(signIn).mockResolvedValue({ ok: false, problem: 'codeExpired' })
    await show(<AccountStep />)
    await sendCodeTo('farter@example.com')
    const codeField = field('account-code')
    if (!codeField) throw new Error('No Code field')
    await type(codeField, '123456')
    await tap(button('Sign in'))

    expect(problem()).toBe('That code no longer works. Send a new one.')
    expect(field('account-code')).toBeNull()
    expect(field('account-email')?.value).toBe('farter@example.com')
    expect(document.activeElement).toBe(field('account-email'))
  })
})
