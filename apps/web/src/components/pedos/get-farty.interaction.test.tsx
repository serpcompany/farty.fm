import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Get Farty on a shared page (#318), in a DOM: the account step offers whoever shared it as a
// friend, ticked; signed in with it ticked, the request goes before the Home Screen steps, and
// unticked or with Not now, none does. On a computer it's the QR code. The account is a stand-in
// that opens, skips and signs in as the provider does; the server is `fetch`.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => {
  type State = { account: { status: string; id?: string }; stepOpen: boolean }
  const listeners = new Set<() => void>()
  let state: State = { account: { status: 'signedOut' }, stepOpen: false }
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
    computer: false
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
vi.mock('@/lib/library-sync', () => ({ unsavedBeforeSignIn: async () => 0 }))
vi.mock('./turnstile', () => ({ Turnstile: () => null }))

const signedIn = { status: 'signedIn', id: 'usersam', email: 'sam@example.test' }

let root: Root | null = null
let container: HTMLDivElement
/** The bodies of the friend requests sent. */
let asked: unknown[]

async function render() {
  const { AccountStep } = await import('./account-step')
  const { GetFartyFlow, useStartGetFarty } = await import('./get-farty')
  function GetFarty() {
    const start = useStartGetFarty()
    return (
      <button type="button" onClick={() => start('maya')}>
        Get Farty
      </button>
    )
  }
  await act(async () =>
    root?.render(
      <>
        <GetFartyFlow qrCode={<svg aria-label="QR code" />}>
          <GetFarty />
        </GetFartyFlow>
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
const offer = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')
const heading = () => container.querySelector('h1')?.textContent ?? null

async function signIn() {
  await act(async () => page.set({ account: signedIn, stepOpen: false }))
  // The request, then the Home Screen steps.
  await act(async () => {})
}

beforeEach(() => {
  vi.resetModules()
  sessionStorage.clear()
  page.set({ account: { status: 'signedOut' }, stepOpen: false })
  page.computer = false
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
    expect(offer()?.checked).toBe(true)
    expect(offer()?.parentElement?.textContent).toBe('Add @maya as a friend')

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
    await act(async () => offer()?.click())
    expect(offer()?.checked).toBe(false)

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
      JSON.stringify({ friend: 'maya', add: true, stage: 'friend', outcome: null })
    )
    page.set({ account: { status: 'checking' } })
    await render()
    expect(asked).toEqual([])
    await signIn()
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
