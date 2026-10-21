import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The beacon's opt-out (#126), in a DOM: Profile's switch off and Global Privacy Control each keep
// the script out, turning sharing off mid-page removes it, and turning it back on doesn't add a
// second until the next page load. Each test imports the modules afresh: a new page load.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TOKEN = 'test-token'

type Page = {
  beaconScripts: () => HTMLScriptElement[]
  setSharing: (on: boolean) => void
}

let root: Root | null = null

/** A new page load: fresh modules, then `<AnalyticsBeacon>` rendered and its effect run. */
async function loadPage(): Promise<Page> {
  vi.resetModules()
  const { AnalyticsBeacon, BEACON_SRC } = await import('./analytics-beacon')
  const { setSharing } = await import('./sharing')
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<AnalyticsBeacon token={TOKEN} />))
  return {
    beaconScripts: () => [
      ...document.querySelectorAll<HTMLScriptElement>(`script[src="${BEACON_SRC}"]`)
    ],
    setSharing: on => {
      act(() => setSharing(on))
    }
  }
}

function setGlobalPrivacyControl(on: boolean): void {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: on, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  setGlobalPrivacyControl(false)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  for (const script of document.querySelectorAll('script')) script.remove()
  document.body.replaceChildren()
  delete (window as Window & { __cfBeacon?: unknown }).__cfBeacon
})

describe('AnalyticsBeacon', () => {
  it('adds one beacon script with the token while sharing is on', async () => {
    const page = await loadPage()
    const scripts = page.beaconScripts()
    expect(scripts).toHaveLength(1)
    expect(JSON.parse(scripts[0]?.getAttribute('data-cf-beacon') ?? '')).toEqual({ token: TOKEN })
  })

  it("adds none with Profile's switch off", async () => {
    localStorage.setItem('pedos.telemetry', 'off')
    const page = await loadPage()
    expect(page.beaconScripts()).toHaveLength(0)
  })

  it('adds none with Global Privacy Control', async () => {
    setGlobalPrivacyControl(true)
    const page = await loadPage()
    expect(page.beaconScripts()).toHaveLength(0)
  })

  it('removes the script and its settings when sharing is turned off mid-page', async () => {
    const page = await loadPage()
    ;(window as Window & { __cfBeacon?: unknown }).__cfBeacon = { token: TOKEN }
    page.setSharing(false)
    expect(page.beaconScripts()).toHaveLength(0)
    expect((window as Window & { __cfBeacon?: unknown }).__cfBeacon).toBeUndefined()
  })

  it('adds no second script when turned back on, until the next page load', async () => {
    const page = await loadPage()
    page.setSharing(false)
    page.setSharing(true)
    expect(page.beaconScripts()).toHaveLength(0)

    act(() => root?.unmount())
    const next = await loadPage()
    expect(next.beaconScripts()).toHaveLength(1)
  })

  it('starts when turned on, on a page that loaded with it off', async () => {
    localStorage.setItem('pedos.telemetry', 'off')
    const page = await loadPage()
    page.setSharing(true)
    expect(page.beaconScripts()).toHaveLength(1)
  })
})
