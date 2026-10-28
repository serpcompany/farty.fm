import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '@/lib/tabs'
import { useBackOnRecord } from './back-on-record'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/audio/player', () => ({ stopPlayback: vi.fn() }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function Probe({ tab, staysPut }: { tab: Tab | null; staysPut: boolean }) {
  useBackOnRecord(tab, staysPut)
  return null
}

const unmounts: (() => void)[] = []

function onA(device: 'phone' | 'computer') {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    query => ({ matches: device === 'computer', media: query }) as MediaQueryList
  )
}

async function show(tab: Tab | null, { staysPut = false } = {}) {
  const root = createRoot(document.createElement('div'))
  unmounts.push(() => root.unmount())
  await act(async () => root.render(<Probe tab={tab} staysPut={staysPut} />))
}

function visibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

const page = (type: 'pagehide' | 'pageshow') => window.dispatchEvent(new Event(type))

beforeEach(() => onA('phone'))

afterEach(() => {
  for (const unmount of unmounts.splice(0)) act(unmount)
  push.mockClear()
  vi.restoreAllMocks()
  visibility('visible')
})

describe('coming back to Farty on a phone', () => {
  it('opens Record after another app', async () => {
    await show('compose')
    visibility('hidden')
    visibility('visible')
    expect(push).toHaveBeenCalledWith('/')
  })

  it('stays where it was after the browser leaves for another page, such as the checkout page, and comes back with Back', async () => {
    await show('compose')
    page('pagehide')
    visibility('hidden')
    visibility('visible')
    page('pageshow')
    visibility('hidden')
    page('pagehide')
    page('pageshow')
    visibility('visible')
    expect(push).not.toHaveBeenCalled()
  })

  it('opens Record after another app that follows a return from another page', async () => {
    await show('compose')
    page('pagehide')
    visibility('hidden')
    visibility('visible')
    page('pageshow')
    visibility('hidden')
    visibility('visible')
    expect(push).toHaveBeenCalledOnce()
  })

  it('stays where it was on Record, outside the tabs, or while the flow or account step is open', async () => {
    await show('record')
    await show(null)
    await show('toots', { staysPut: true })
    visibility('hidden')
    visibility('visible')
    expect(push).not.toHaveBeenCalled()
  })
})

describe('coming back to Farty on a computer', () => {
  it('stays where it was', async () => {
    onA('computer')
    await show('compose')
    visibility('hidden')
    visibility('visible')
    expect(push).not.toHaveBeenCalled()
  })
})
