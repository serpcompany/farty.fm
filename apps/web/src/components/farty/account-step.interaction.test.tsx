import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendCode, signIn } from '@/lib/account'
import { button, closeScreens, pageText, show, tap, type } from '@/test-support/screen'
import { AccountStep } from './account-step'

type Widget = { siteKey: string; onToken(token: string | null): void; onFailed(): void }

const page = vi.hoisted(() => ({ widgets: [] as Widget[] }))

vi.mock('@/lib/account', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/account')>()
  return { ...real, sendCode: vi.fn(real.sendCode), signIn: vi.fn(real.signIn) }
})
vi.mock('@/lib/library-sync', () => ({ unsavedBeforeSignIn: async () => 0 }))
vi.mock('./account-provider', () => ({
  useAccount: () => ({
    stepOpen: true,
    account: { status: 'signedOut' },
    skipStep: vi.fn(),
    finishSignIn: vi.fn()
  })
}))
vi.mock('./turnstile', async () => {
  const { useEffect } = await import('react')
  return {
    Turnstile: (props: Widget) => {
      useEffect(() => {
        page.widgets.push(props)
      }, [])
      return null
    }
  }
})

function server(...siteKey: Response[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.startsWith('/api/auth/turnstile')) {
      return (siteKey.length > 1 ? siteKey.shift() : siteKey[0])?.clone() ?? Response.error()
    }
    return Response.json({ success: true })
  })
}
const keyAnswer = () => Response.json({ siteKey: '1x00000000000000000000AA' })

const field = (id: string) => document.body.querySelector<HTMLInputElement>(`#${id}`)
const problem = () => document.body.querySelector('[role="alert"]')?.textContent ?? null
const codesSent = (fetch: ReturnType<typeof server>) =>
  fetch.mock.calls.filter(([url]) => String(url).includes('send-verification-otp'))
const giveToken = (widget: number, token: string) =>
  act(async () => page.widgets[widget].onToken(token))

async function sendCodeTo(email: string) {
  const emailField = field('account-email')
  if (!emailField) throw new Error('No Email field')
  await type(emailField, email)
  await giveToken(0, 'token-1')
  await tap(button('Send code'))
}

beforeEach(() => {
  page.widgets = []
  sessionStorage.setItem(
    'pedos.accountStep.draft',
    JSON.stringify({ phase: 'email', email: 'a@example.test' })
  )
})

afterEach(() => {
  closeScreens()
  sessionStorage.clear()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('the account step', () => {
  it.each([
    ['invalidEmail', 'Enter a valid email address.'],
    ['tooManyTries', 'Too many tries. Wait a few minutes, then try again.'],
    ['notChecked', "Couldn't check that you're a person. Try again."],
    ['unavailable', "Accounts aren't available right now."],
    ['failed', "Couldn't reach Farty. Check your connection and try again."]
  ] as const)('says what went wrong in words (%s)', async (code, words) => {
    server(keyAnswer())
    vi.mocked(sendCode).mockResolvedValueOnce({ ok: false, problem: code })
    await show(<AccountStep />)
    await sendCodeTo('farter@example.com')

    expect(problem()).toBe(words)
    expect(field('account-email')).not.toBeNull()
  })

  it('goes back to the Email field when the code no longer works', async () => {
    server(keyAnswer())
    vi.mocked(sendCode).mockResolvedValueOnce({ ok: true, value: null })
    vi.mocked(signIn).mockResolvedValueOnce({ ok: false, problem: 'codeExpired' })
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

describe('Send code and Turnstile', () => {
  it("waits for the widget's token, then sends the code with it", async () => {
    const fetch = server(keyAnswer())
    await show(<AccountStep />)
    expect(page.widgets).toHaveLength(1)
    expect(button('Send code').disabled).toBe(true)

    await giveToken(0, 'token-1')
    expect(button('Send code').disabled).toBe(false)
    await tap(button('Send code'))
    const [send] = codesSent(fetch)
    expect(new Headers(send?.[1]?.headers).get('x-captcha-response')).toBe('token-1')
    expect(pageText()).toContain('We sent a 6-digit code to a@example.test.')
  })

  it("reads the site key again on a tap when it couldn't be read", async () => {
    const fetch = server(new Response('oops', { status: 500 }), keyAnswer())
    await show(<AccountStep />)
    expect(problem()).toBe("Couldn't reach Farty. Check your connection and try again.")
    expect(page.widgets).toHaveLength(0)
    expect(button('Send code').disabled).toBe(false)

    await tap(button('Send code'))
    const keyReads = fetch.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/auth/turnstile')
    )
    expect(keyReads).toHaveLength(2)
    expect(problem()).toBeNull()
    expect(page.widgets).toHaveLength(1)
    expect(codesSent(fetch)).toHaveLength(0)
    expect(button('Send code').disabled).toBe(true)
  })

  it("renders a new widget on a tap when Turnstile couldn't load", async () => {
    server(keyAnswer())
    await show(<AccountStep />)
    await act(async () => page.widgets[0].onFailed())
    expect(problem()).toBe("Couldn't reach Farty. Check your connection and try again.")
    expect(button('Send code').disabled).toBe(false)

    await tap(button('Send code'))
    expect(page.widgets).toHaveLength(2)
    expect(problem()).toBeNull()
    await giveToken(1, 'token-2')
    expect(button('Send code').disabled).toBe(false)
  })

  it('drops the token and renders a new widget on a tap when Turnstile fails after giving one', async () => {
    const fetch = server(keyAnswer())
    await show(<AccountStep />)
    await giveToken(0, 'token-1')
    await act(async () => page.widgets[0].onFailed())
    expect(button('Send code').disabled).toBe(false)

    await tap(button('Send code'))
    expect(codesSent(fetch)).toHaveLength(0)
    expect(page.widgets).toHaveLength(2)
    expect(button('Send code').disabled).toBe(true)
  })

  it('tries again when the browser comes back online', async () => {
    server(keyAnswer())
    await show(<AccountStep />)
    await act(async () => page.widgets[0].onFailed())
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(page.widgets).toHaveLength(2)
    expect(button('Send code').disabled).toBe(true)
  })
})
