import { act, type ReactNode, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Get Farty on a shared page (#318), in a DOM: the account step offers whoever shared it as a
// friend, ticked; signed in at the step with it ticked, the request goes before the Home Screen
// steps, and unticked or with Not now, none does. A session read as signed in, another page, or a
// reload offline never sends it. On a computer it's the QR code. The account is a stand-in that
// opens, skips and signs in as the provider does; the path is a stand-in for the router's; the
// server is `fetch`.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => {
  type State = { account: { status: string; id?: string }; stepOpen: boolean; path: string }
  const listeners = new Set<() => void>()
  let state: State = { account: { status: 'signedOut' }, stepOpen: false, path: '/@maya/' }
  return {
    get: () => state,
    set(next: Partial<State>) {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    computer: false,
    offline: false
  }
})

vi.mock('./account-provider', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useAccount: () => ({
      ...useSyncExternalStore(page.subscribe, page.get),
      stepReason: 'keep',
      openStep: () => page.set({ stepOpen: true }),
      skipStep: () => page.set({ stepOpen: false }),
      finishSignIn: (account: { status: string }) => page.set({ account, stepOpen: false })
    })
  }
})
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  return { usePathname: () => useSyncExternalStore(page.subscribe, () => page.get().path) }
})
vi.mock('@/lib/library-sync', () => ({ unsavedBeforeSignIn: async () => 0 }))
// Turnstile passes at once; the code is sent, and the code signs in.
vi.mock('./turnstile', async () => {
  const { useEffect } = await import('react')
  return {
    Turnstile: ({ onToken }: { onToken(token: string): void }) => {
      useEffect(() => onToken('token'), [onToken])
      return null
    }
  }
})
vi.mock('@/lib/account', async original => ({
  ...(await original<typeof import('@/lib/account')>()),
  sendCode: async () => ({ ok: true, value: null }),
  signIn: async () => ({ ok: true, value: signedIn })
}))

const signedIn = vi.hoisted(() => ({
  status: 'signedIn' as const,
  id: 'usersam',
  email: 'sam@example.test',
  marketingEmail: false,
  showFartPlaces: true
}))

let root: Root | null = null
let container: HTMLDivElement
/** The bodies of the friend requests sent. */
let asked: unknown[]

async function render() {
  const { AccountStep } = await import('./account-step')
  const { GetFartyFlow, useStartGetFarty } = await import('./get-farty')
  // As `[atHandle]/layout.tsx`: the flow runs only on shared and profile pages.
  function SharedPages({ children }: { children: ReactNode }) {
    const { path } = useSyncExternalStore(page.subscribe, page.get)
    return path.startsWith('/@') ? children : null
  }
  // Each page's Get Farty offers whoever's page it is.
  function GetFarty() {
    const start = useStartGetFarty()
    const { path } = useSyncExternalStore(page.subscribe, page.get)
    return (
      <button type="button" onClick={() => start(path.split('/')[1].slice(1))}>
        Get Farty
      </button>
    )
  }
  await act(async () =>
    root?.render(
      <>
        <SharedPages>
          <GetFartyFlow qrCode={<svg aria-label="QR code" />}>
            <GetFarty />
          </GetFartyFlow>
        </SharedPages>
        <AccountStep />
      </>
    )
  )
}

const button = (name: string) => {
  const found = [...document.querySelectorAll('button')].find(b => b.textContent === name)
  if (!found) throw new Error(`no ${name} button`)
  return found
}
const tap = (name: string) => act(async () => button(name).click())
const offer = () => container.querySelector<HTMLElement>('[role="checkbox"]')
const ticked = () => offer()?.getAttribute('aria-checked') === 'true'
const heading = () => container.querySelector('h1')?.textContent ?? null
const kept = () => JSON.parse(sessionStorage.getItem('pedos.getFarty') ?? 'null')
const goTo = (path: string) => act(async () => page.set({ path }))

/** Submits the account step's form: the email, then the code. */
const submit = () =>
  act(async () => {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })

/** Signs in at the account step, as a person does: Send code, then the code. */
async function signIn() {
  await submit()
  await submit()
  // The request, then the Home Screen steps.
  await act(async () => {})
}

/** The session, read at last (a reload, or back online). */
async function sessionRead(account: { status: string }) {
  await act(async () => page.set({ account }))
  await act(async () => {})
}

beforeEach(() => {
  vi.resetModules()
  sessionStorage.clear()
  page.set({ account: { status: 'signedOut' }, stepOpen: false, path: '/@maya/' })
  // The step's draft holds the email, as typing it would.
  sessionStorage.setItem(
    'pedos.accountStep.draft',
    JSON.stringify({ phase: 'email', email: 'sam@example.test' })
  )
  page.computer = false
  page.offline = false
  asked = []
  vi.spyOn(window, 'matchMedia').mockImplementation(
    query =>
      ({
        matches: page.computer && query.includes('pointer: fine'),
        addEventListener: () => {},
        removeEventListener: () => {}
      }) as unknown as MediaQueryList
  )
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.startsWith('/api/auth/turnstile')) return Response.json({ siteKey: '1x00000000' })
    if (url === '/api/friends/' && init?.method === 'POST') {
      asked.push(JSON.parse(String(init.body)))
      if (page.offline) return new Response(null, { status: 503 })
      return Response.json({ state: 'requested' }, { status: 201 })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
})

describe('Get Farty on a phone', () => {
  it('offers whoever shared the page, ticked, and asks them once signed in', async () => {
    await render()
    await tap('Get Farty')
    expect(heading()).toBe('Make a free account')
    expect(ticked()).toBe(true)
    expect(offer()?.closest('label')?.textContent).toBe('Add @maya as a friend')

    await signIn()
    expect(asked).toEqual([{ handle: 'maya' }])
    expect(heading()).toBe('Get the app')
    expect(container.textContent).toContain('You asked @maya to be friends.')
    expect(container.querySelector('[data-testid="install-guide"]')).not.toBeNull()

    await tap('Done')
    expect(heading()).toBeNull()
    expect(sessionStorage.getItem('pedos.getFarty')).toBeNull()
  })

  it('unticked, asks no one, and still shows the Home Screen steps', async () => {
    await render()
    await tap('Get Farty')
    await act(async () => offer()?.closest('label')?.click())
    expect(ticked()).toBe(false)

    await signIn()
    expect(asked).toEqual([])
    expect(heading()).toBe('Get the app')
    expect(container.textContent).not.toContain('@maya')
  })

  it('goes on to the Home Screen steps after Not now, asking no one', async () => {
    await render()
    await tap('Get Farty')
    await tap('Not now')
    await act(async () => {})
    expect(asked).toEqual([])
    expect(heading()).toBe('Get the app')
  })

  it('sends a request still to go after a reload, once the session is read', async () => {
    sessionStorage.setItem(
      'pedos.getFarty',
      JSON.stringify({
        friend: 'maya',
        add: true,
        stage: 'friend',
        outcome: null,
        page: '/@maya/'
      })
    )
    page.set({ account: { status: 'checking' } })
    await render()
    expect(asked).toEqual([])
    await sessionRead(signedIn)
    expect(asked).toEqual([{ handle: 'maya' }])
    expect(container.textContent).toContain('You asked @maya to be friends.')
  })

  it('sends nothing for a tap before the session is read, when it reads signed in', async () => {
    page.set({ account: { status: 'checking' } })
    await render()
    await tap('Get Farty')
    await sessionRead(signedIn)
    // Signed in already: no account to make, so the step closes and the flow ends.
    expect(page.get().stepOpen).toBe(false)
    // Were the step still there, Not now would be the only way out of it.
    if (container.textContent?.includes('Not now')) await tap('Not now')
    await act(async () => {})
    expect(asked).toEqual([])
    expect(heading()).toBeNull()
    expect(kept()).toBeNull()
  })

  it('ends on another page, so the request never goes to an earlier friend', async () => {
    await render()
    await tap('Get Farty')
    // Away from the shared page with the step still open, signed in there, then another person's.
    await goTo('/')
    expect(kept()).toBeNull()
    expect(offer()).toBeNull()
    await signIn()
    await goTo('/@sam/')
    await act(async () => {})
    expect(asked).toEqual([])
    expect(heading()).toBeNull()
  })

  it("offers the person whose page started it, not an earlier one's", async () => {
    await render()
    await tap('Get Farty')
    await tap('Not now')
    await tap('Done')
    await goTo('/@sam/')
    await tap('Get Farty')
    expect(offer()?.closest('label')?.textContent).toBe('Add @sam as a friend')
    await signIn()
    expect(asked).toEqual([{ handle: 'sam' }])
  })

  it('offers Try again when the request fails, which sends it again', async () => {
    page.offline = true
    await render()
    await tap('Get Farty')
    await signIn()
    expect(heading()).toBe('Get the app')
    expect(container.textContent).toContain("Couldn't send the request.")
    page.offline = false
    await tap('Try again')
    await act(async () => {})
    expect(asked).toEqual([{ handle: 'maya' }, { handle: 'maya' }])
    expect(container.textContent).toContain('You asked @maya to be friends.')
  })

  it('keeps a request still to go after a reload offline, and sends it once back online', async () => {
    sessionStorage.setItem(
      'pedos.getFarty',
      JSON.stringify({
        friend: 'maya',
        add: true,
        stage: 'friend',
        outcome: null,
        page: '/@maya/'
      })
    )
    page.set({ account: { status: 'unreachable' } })
    await render()
    await act(async () => {})
    expect(asked).toEqual([])
    expect(kept()?.stage).toBe('friend')
    expect(container.textContent).not.toContain("Couldn't send the request.")
    await sessionRead(signedIn)
    expect(asked).toEqual([{ handle: 'maya' }])
    expect(container.textContent).toContain('You asked @maya to be friends.')
  })
})

describe('Get Farty on a computer', () => {
  it('shows the QR code, and no account step', async () => {
    page.computer = true
    await render()
    await tap('Get Farty')
    expect(page.get().stepOpen).toBe(false)
    expect(heading()).toBeNull()
    expect(document.body.textContent).toContain('Scan to open Farty on your phone')
    expect(document.querySelector('[aria-label="QR code"]')).not.toBeNull()
  })
})
