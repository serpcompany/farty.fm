import { act, type ReactNode, useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, closeScreens, pageText, show, tap } from '@/test-support/screen'

const page = vi.hoisted(() => {
  type State = { account: { status: string; id?: string }; stepOpen: boolean; path: string }
  const listeners = new Set<() => void>()
  let state: State = { account: { status: 'signedOut' }, stepOpen: false, path: '/u/maya/' }
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
  marketingEmail: false
}))

let asked: unknown[]

async function render() {
  const { AccountStep } = await import('./account-step')
  const { GetFartyFlow, useStartGetFarty } = await import('./get-farty')
  function SharedPages({ children }: { children: ReactNode }) {
    const { path } = useSyncExternalStore(page.subscribe, page.get)
    return path.startsWith('/u/') ? children : null
  }
  function GetFarty() {
    const start = useStartGetFarty()
    const { path } = useSyncExternalStore(page.subscribe, page.get)
    return (
      <button type="button" onClick={() => start(path.split('/')[2])}>
        Get Farty
      </button>
    )
  }
  await show(
    <>
      <SharedPages>
        <GetFartyFlow qrCode={<svg aria-label="QR code" />}>
          <GetFarty />
        </GetFartyFlow>
      </SharedPages>
      <AccountStep />
    </>
  )
}

const tapButton = (name: string) => tap(button(name))
const offer = () => document.body.querySelector<HTMLElement>('[role="checkbox"]')
const ticked = () => offer()?.getAttribute('aria-checked') === 'true'
const heading = () => document.body.querySelector('h1')?.textContent ?? null
const kept = () => JSON.parse(sessionStorage.getItem('pedos.getFarty') ?? 'null')
const goTo = (path: string) => act(async () => page.set({ path }))

const submit = () =>
  act(async () => {
    document.body
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })

async function signIn() {
  await submit()
  await submit()
  await act(async () => {})
}

async function sessionRead(account: { status: string }) {
  await act(async () => page.set({ account }))
  await act(async () => {})
}

beforeEach(() => {
  vi.resetModules()
  sessionStorage.clear()
  page.set({ account: { status: 'signedOut' }, stepOpen: false, path: '/u/maya/' })
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
})

afterEach(() => {
  closeScreens()
  vi.restoreAllMocks()
})

describe('Get Farty on a phone', () => {
  it('offers whoever shared the page, ticked, and asks them once signed in', async () => {
    await render()
    await tapButton('Get Farty')
    expect(heading()).toBe('Make a free account')
    expect(ticked()).toBe(true)
    expect(offer()?.closest('label')?.textContent).toBe('Add @maya as a friend')

    await signIn()
    expect(asked).toEqual([{ handle: 'maya' }])
    expect(heading()).toBe('Get the app')
    expect(pageText()).toContain('You asked @maya to be friends.')
    expect(document.body.querySelector('[data-testid="install-guide"]')).not.toBeNull()

    await tapButton('Done')
    expect(heading()).toBeNull()
    expect(sessionStorage.getItem('pedos.getFarty')).toBeNull()
  })

  it('unticked, asks no one, and still shows the Home Screen steps', async () => {
    await render()
    await tapButton('Get Farty')
    await act(async () => offer()?.closest('label')?.click())
    expect(ticked()).toBe(false)

    await signIn()
    expect(asked).toEqual([])
    expect(heading()).toBe('Get the app')
    expect(pageText()).not.toContain('@maya')
  })

  it('goes on to the Home Screen steps after Not now, asking no one', async () => {
    await render()
    await tapButton('Get Farty')
    await tapButton('Not now')
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
        page: '/u/maya/'
      })
    )
    page.set({ account: { status: 'checking' } })
    await render()
    expect(asked).toEqual([])
    await sessionRead(signedIn)
    expect(asked).toEqual([{ handle: 'maya' }])
    expect(pageText()).toContain('You asked @maya to be friends.')
  })

  it('sends nothing for a tap before the session is read, when it reads signed in', async () => {
    page.set({ account: { status: 'checking' } })
    await render()
    await tapButton('Get Farty')
    await sessionRead(signedIn)
    expect(page.get().stepOpen).toBe(false)
    if (pageText()?.includes('Not now')) await tapButton('Not now')
    await act(async () => {})
    expect(asked).toEqual([])
    expect(heading()).toBeNull()
    expect(kept()).toBeNull()
  })

  it('ends on another page, so the request never goes to an earlier friend', async () => {
    await render()
    await tapButton('Get Farty')
    await goTo('/')
    expect(kept()).toBeNull()
    expect(offer()).toBeNull()
    await signIn()
    await goTo('/u/sam/')
    await act(async () => {})
    expect(asked).toEqual([])
    expect(heading()).toBeNull()
  })

  it("offers the person whose page started it, not an earlier one's", async () => {
    await render()
    await tapButton('Get Farty')
    await tapButton('Not now')
    await tapButton('Done')
    await goTo('/u/sam/')
    await tapButton('Get Farty')
    expect(offer()?.closest('label')?.textContent).toBe('Add @sam as a friend')
    await signIn()
    expect(asked).toEqual([{ handle: 'sam' }])
  })

  it('offers Try again when the request fails, which sends it again', async () => {
    page.offline = true
    await render()
    await tapButton('Get Farty')
    await signIn()
    expect(heading()).toBe('Get the app')
    expect(pageText()).toContain("Couldn't send the request.")
    page.offline = false
    await tapButton('Try again')
    await act(async () => {})
    expect(asked).toEqual([{ handle: 'maya' }, { handle: 'maya' }])
    expect(pageText()).toContain('You asked @maya to be friends.')
  })

  it('keeps a request still to go after a reload offline, and sends it once back online', async () => {
    sessionStorage.setItem(
      'pedos.getFarty',
      JSON.stringify({
        friend: 'maya',
        add: true,
        stage: 'friend',
        outcome: null,
        page: '/u/maya/'
      })
    )
    page.set({ account: { status: 'unreachable' } })
    await render()
    await act(async () => {})
    expect(asked).toEqual([])
    expect(kept()?.stage).toBe('friend')
    expect(pageText()).not.toContain("Couldn't send the request.")
    await sessionRead(signedIn)
    expect(asked).toEqual([{ handle: 'maya' }])
    expect(pageText()).toContain('You asked @maya to be friends.')
  })
})

describe('Get Farty on a computer', () => {
  it('shows the QR code, and no account step', async () => {
    page.computer = true
    await render()
    await tapButton('Get Farty')
    expect(page.get().stepOpen).toBe(false)
    expect(heading()).toBeNull()
    expect(document.body.textContent).toContain('Scan to open Farty on your phone')
    expect(document.querySelector('[aria-label="QR code"]')).not.toBeNull()
  })
})
