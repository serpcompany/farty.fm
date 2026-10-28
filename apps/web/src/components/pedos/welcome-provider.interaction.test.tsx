import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { welcomedKey } from '@/lib/welcomed'
import { useWelcome, WelcomeProvider } from './welcome-provider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let welcome: ReturnType<typeof useWelcome>

function Probe() {
  welcome = useWelcome()
  return null
}

const unmounts: (() => void)[] = []

async function openFarty() {
  const root = createRoot(document.createElement('div'))
  unmounts.push(() => root.unmount())
  await act(async () =>
    root.render(
      <WelcomeProvider>
        <Probe />
      </WelcomeProvider>
    )
  )
}

afterEach(() => {
  act(() => {
    for (const unmount of unmounts.splice(0)) unmount()
  })
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute('data-welcomed')
})

describe('WelcomeProvider', () => {
  it('shows Welcome in a browser that has never opened Farty', async () => {
    await openFarty()
    expect(welcome.showsWelcome).toBe(true)
  })

  it('shows no Welcome once Farty has been opened here', async () => {
    localStorage.setItem(welcomedKey, '1')
    await openFarty()
    expect(welcome.showsWelcome).toBe(false)
  })

  it('remembers Welcome is done, in storage and on the page', async () => {
    await openFarty()
    act(() => welcome.finishWelcome())

    expect(welcome.showsWelcome).toBe(false)
    expect(localStorage.getItem(welcomedKey)).toBe('1')
    expect(document.documentElement.hasAttribute('data-welcomed')).toBe(true)
  })

  it('shows Welcome, without crashing, where storage can’t be read', async () => {
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    await openFarty()

    expect(read).toHaveBeenCalled()
    expect(welcome.showsWelcome).toBe(true)
  })

  it('finishes Welcome for this page load where storage is blocked', async () => {
    await openFarty()
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    act(() => welcome.finishWelcome())

    expect(write).toHaveBeenCalled()
    expect(welcome.showsWelcome).toBe(false)
    expect(document.documentElement.hasAttribute('data-welcomed')).toBe(true)
  })
})
