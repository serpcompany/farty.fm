import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The shared AudioContext against a page that hides and shows. On iPhone a context that lived
// through a hidden page can say it runs while its clock stands still (#280).

class FakeContext {
  state: AudioContextState = 'suspended'
  close = vi.fn(async () => {
    this.state = 'closed'
  })
}

class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

let page = new FakePage()
let pageWindow = new EventTarget()

function setVisibility(state: DocumentVisibilityState) {
  page.visibilityState = state
  page.dispatchEvent(new Event('visibilitychange'))
}

async function context() {
  vi.resetModules()
  return import('./context')
}

beforeEach(() => {
  page = new FakePage()
  pageWindow = new EventTarget()
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', pageWindow)
  vi.stubGlobal('AudioContext', FakeContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the shared AudioContext', () => {
  it('is the same one while the page shows', async () => {
    const { audioContext } = await context()
    const first = audioContext()
    expect(audioContext()).toBe(first)
  })

  it('is replaced once the page shows again, and the old one closed', async () => {
    const { audioContext } = await context()
    const first = audioContext()
    setVisibility('hidden')
    // While hidden, it's kept: a new one would live through the hide too.
    expect(audioContext()).toBe(first)
    setVisibility('visible')
    const second = audioContext()
    expect(second).not.toBe(first)
    expect((first as unknown as FakeContext).close).toHaveBeenCalledOnce()
    expect(audioContext()).toBe(second)
  })

  it('is replaced after the page was put in the back-forward cache', async () => {
    const { audioContext } = await context()
    const first = audioContext()
    pageWindow.dispatchEvent(new Event('pagehide'))
    expect(audioContext()).not.toBe(first)
  })

  it('made while the page is hidden, is replaced once it shows', async () => {
    const { audioContext } = await context()
    page.visibilityState = 'hidden'
    const first = audioContext()
    expect(audioContext()).toBe(first)
    setVisibility('visible')
    expect(audioContext()).not.toBe(first)
  })
})
