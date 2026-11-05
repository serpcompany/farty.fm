import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafariAllowNote } from './safari-allow-note'

// When the note shows (#374), in a DOM, with the real `shouldTellOfSafariAllow`. What the browser
// remembers and which browser this is are set here; the rest of the app is a stub.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = {
  memory: 'forgotten' as 'remembered' | 'forgotten' | 'unknown',
  iPhoneSafari: true,
  flow: null as string | null,
  capture: { kind: 'idle' },
  reviewOpen: false,
  showsWelcome: false,
  stepOpen: false
}

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    flow: state.flow,
    capture: state.capture,
    reviewOpen: state.reviewOpen,
    showsWelcome: state.showsWelcome
  })
}))
vi.mock('./account-provider', () => ({ useAccount: () => ({ stepOpen: state.stepOpen }) }))
vi.mock('@/lib/audio/recorder', () => ({ microphoneGrantMemory: () => state.memory }))
vi.mock('@/lib/install', () => ({
  currentlyUsesSafariMicrophoneSetting: () => state.iPhoneSafari
}))

let container: HTMLDivElement
let root: Root

const note = () => document.body.textContent?.includes('Make Farty louder') ?? false

async function show() {
  await act(async () => root.render(<SafariAllowNote />))
}

/** Leaves Compose and comes back, which mounts the note again. */
async function comeBack() {
  await act(async () => root.unmount())
  root = createRoot(container)
  await show()
}

beforeEach(() => {
  Object.assign(state, {
    memory: 'forgotten',
    iPhoneSafari: true,
    flow: null,
    capture: { kind: 'idle' },
    reviewOpen: false,
    showsWelcome: false,
    stepOpen: false
  })
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('SafariAllowNote', () => {
  it('says what it gets and how, and closes on Got it, never to show again', async () => {
    await show()
    expect(note()).toBe(true)
    const text = document.body.textContent
    expect(text).toContain('louder sound and no microphone question')
    expect(text).toContain('Apps → Safari → Microphone → Allow')
    expect(text).toContain('every website')

    const gotIt = [...document.querySelectorAll('button')].find(b => b.textContent === 'Got it')
    await act(async () => gotIt?.click())
    await vi.waitFor(() => expect(note()).toBe(false))

    await comeBack()
    expect(note()).toBe(false)
  })

  it('doesn’t show again after leaving without Got it', async () => {
    await show()
    expect(note()).toBe(true)

    await comeBack()
    expect(note()).toBe(false)
  })

  it('never shows once the grant is remembered', async () => {
    state.memory = 'remembered'
    await show()
    expect(note()).toBe(false)

    state.memory = 'forgotten'
    await comeBack()
    expect(note()).toBe(false)
  })

  it('never shows in another browser', async () => {
    state.iPhoneSafari = false
    await show()
    expect(note()).toBe(false)
  })

  it.each([
    ['a take', () => (state.capture = { kind: 'recording' })],
    ['Recording, Review or Result', () => (state.flow = 'review')],
    ['a saved Recording’s review', () => (state.reviewOpen = true)],
    ['Welcome', () => (state.showsWelcome = true)],
    ['the account step', () => (state.stepOpen = true)]
  ])('waits for %s to close, and then shows', async (_, cover) => {
    cover()
    await show()
    expect(note()).toBe(false)

    state.capture = { kind: 'idle' }
    state.flow = null
    state.reviewOpen = false
    state.showsWelcome = false
    state.stepOpen = false
    await show()
    expect(note()).toBe(true)
  })

  it('closes when the page hides, since it comes back on Record', async () => {
    await show()
    expect(note()).toBe(true)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    vi.restoreAllMocks()
    await vi.waitFor(() => expect(note()).toBe(false))
  })
})
