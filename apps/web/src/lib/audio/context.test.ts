import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The shared AudioContext against a page that hides and shows. On iPhone a context that lived
// through a hidden page can say it runs while its clock stands still (#280).

/** A sound playing on a `FakeContext`. Like Chromium's, it never ends once its context closes. */
class FakeSource {
  started = false
  stopped = false
  buffer: unknown = null
  onended: (() => void) | null = null
  constructor(readonly context: FakeContext) {}
  connect() {}
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
    if (this.context.state !== 'closed') this.onended?.()
  }
}

class FakeContext {
  state: AudioContextState = 'suspended'
  destination = {}
  sources: FakeSource[] = []
  /** Decodes that finish only when the test says so. */
  decodes: (() => void)[] = []
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  async resume() {
    if (this.state !== 'closed') this.state = 'running'
  }
  decodeAudioData() {
    return new Promise(resolve => this.decodes.push(() => resolve({ duration: 1 })))
  }
  createBufferSource() {
    const source = new FakeSource(this)
    this.sources.push(source)
    return source
  }
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

/** The context and the player, loaded together as the app loads them. */
async function contextAndPlayer() {
  vi.resetModules()
  return { ...(await import('./context')), ...(await import('./player')) }
}

const wav = async () => new ArrayBuffer(8)

/** Lets the awaits inside `play` run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

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

// A Toot can start playing while the page is hidden: Song Creator plays it once it's made, after
// the hide stopped playback. When the page shows, its context is replaced, and closing a context
// never ends what plays on it (#283).
describe('a sound on a context that is replaced', () => {
  it('ends, says so once, and leaves the player idle', async () => {
    const { audioContext, play, stopPlayback } = await contextAndPlayer()
    setVisibility('hidden')
    const old = audioContext() as unknown as FakeContext
    const ended = vi.fn()
    const playing = play('toot', wav, null, ended)
    await settle()
    old.decodes[0]?.()
    await playing
    expect(old.sources[0]?.started).toBe(true)

    setVisibility('visible')
    expect(audioContext()).not.toBe(old)
    expect(old.close).toHaveBeenCalledOnce()
    expect(old.sources[0]?.stopped).toBe(true)
    expect(ended).toHaveBeenCalledOnce()

    // Idle: nothing is left for Stop to stop.
    stopPlayback()
    expect(ended).toHaveBeenCalledOnce()
  })

  it('still loading, never starts and says it is over', async () => {
    const { audioContext, play } = await contextAndPlayer()
    setVisibility('hidden')
    const old = audioContext() as unknown as FakeContext
    const ended = vi.fn()
    const playing = play('toot', wav, null, ended)
    await settle()

    setVisibility('visible')
    audioContext()
    old.decodes[0]?.()
    await playing
    expect(old.sources).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
  })
})
