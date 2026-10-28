import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The account step's Turnstile check (#237), in a DOM: Send code waits for the widget's token, and
// when the site key can't be read or Turnstile can't load, a tap on Send code tries again, so a
// guest is never left with nothing to tap but Not now. The server is `fetch`, answering as the
// routes do; the widget is a stand-in that hands over its callbacks.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Widget = { siteKey: string; onToken(token: string | null): void; onFailed(): void }

const page = vi.hoisted(() => ({ widgets: [] as Widget[] }))

vi.mock('./account-provider', () => ({
  useAccount: () => ({
    account: { status: 'signedOut' },
    stepOpen: true,
    skipStep: vi.fn(),
    finishSignIn: vi.fn()
  })
}))
vi.mock('@/lib/library-sync', () => ({ unsavedBeforeSignIn: async () => 0 }))
// Each mount is a new widget (a new React key).
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

let root: Root | null = null
let container: HTMLDivElement

/** The server: the site key answers `siteKey` in turn (the last one after that), a code is sent. */
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

async function render() {
  const { AccountStep } = await import('./account-step')
  await act(async () => root?.render(<AccountStep />))
}

const sendButton = () => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Send code')
  if (!button) throw new Error('no Send code button')
  return button
}
const alert = () => container.querySelector('[role="alert"]')?.textContent ?? null

async function tapSend() {
  await act(async () => sendButton().click())
}

beforeEach(() => {
  page.widgets = []
  // The step's draft holds the email, as typing it would.
  sessionStorage.setItem(
    'pedos.accountStep.draft',
    JSON.stringify({ phase: 'email', email: 'a@example.test' })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('Send code and Turnstile', () => {
  it("waits for the widget's token, then sends the code with it", async () => {
    const fetch = server(keyAnswer())
    await render()
    expect(page.widgets).toHaveLength(1)
    expect(sendButton().disabled).toBe(true)

    await act(async () => page.widgets[0].onToken('token-1'))
    expect(sendButton().disabled).toBe(false)
    await tapSend()
    const send = fetch.mock.calls.find(([url]) => String(url).includes('send-verification-otp'))
    expect(new Headers(send?.[1]?.headers).get('x-captcha-response')).toBe('token-1')
    expect(container.textContent).toContain('We sent a 6-digit code to a@example.test.')
  })

  it("reads the site key again on a tap when it couldn't be read", async () => {
    const fetch = server(new Response('oops', { status: 500 }), keyAnswer())
    await render()
    expect(alert()).toBe("Couldn't reach Farty. Check your connection and try again.")
    expect(page.widgets).toHaveLength(0)
    expect(sendButton().disabled).toBe(false)

    await tapSend()
    const keyReads = fetch.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/auth/turnstile')
    )
    expect(keyReads).toHaveLength(2)
    expect(alert()).toBeNull()
    expect(page.widgets).toHaveLength(1)
    // Nothing was sent without a token, and the new widget's token is needed first.
    expect(fetch.mock.calls.some(([url]) => String(url).includes('send-verification-otp'))).toBe(
      false
    )
    expect(sendButton().disabled).toBe(true)
  })

  it("renders a new widget on a tap when Turnstile couldn't load", async () => {
    server(keyAnswer())
    await render()
    await act(async () => page.widgets[0].onFailed())
    expect(alert()).toBe("Couldn't reach Farty. Check your connection and try again.")
    expect(sendButton().disabled).toBe(false)

    await tapSend()
    expect(page.widgets).toHaveLength(2)
    expect(alert()).toBeNull()
    await act(async () => page.widgets[1].onToken('token-2'))
    expect(sendButton().disabled).toBe(false)
  })

  it('tries again when the browser comes back online', async () => {
    server(keyAnswer())
    await render()
    await act(async () => page.widgets[0].onFailed())
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(page.widgets).toHaveLength(2)
    expect(sendButton().disabled).toBe(true)
  })
})
