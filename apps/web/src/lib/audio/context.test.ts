import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    if (this.context.state === 'running') this.onended?.()
  }
}

class FakeContext {
  state: AudioContextState = 'suspended'
  destination = {}
  sources: FakeSource[] = []
  decodes: (() => void)[] = []
  finishClose = () => {}
  close = vi.fn(
    () =>
      new Promise<void>(resolve => {
        this.finishClose = () => {
          this.state = 'closed'
          resolve()
        }
      })
  )
  suspend() {
    if (this.state !== 'closed') this.state = 'suspended'
  }
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

async function contextAndPlayer() {
  vi.resetModules()
  return { ...(await import('./context')), ...(await import('./player')) }
}

const wav = async () => new ArrayBuffer(8)

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

async function tootLoading(visibility: DocumentVisibilityState) {
  const player = await contextAndPlayer()
  if (visibility === 'hidden') setVisibility('hidden')
  const old = player.audioContext() as unknown as FakeContext
  const ended = vi.fn()
  const playing = player.play('toot', wav, null, ended)
  await settle()
  return { ...player, old, ended, playing }
}

async function tootPlaying(visibility: DocumentVisibilityState) {
  const toot = await tootLoading(visibility)
  toot.old.decodes[0]?.()
  await toot.playing
  expect(toot.old.sources[0]?.started).toBe(true)
  return toot
}

describe('a sound on a context that is replaced', () => {
  it('ends, says so once, and leaves the player idle', async () => {
    const { audioContext, stopPlayback, old, ended } = await tootPlaying('hidden')

    setVisibility('visible')
    expect(audioContext()).not.toBe(old)
    expect(old.close).toHaveBeenCalledOnce()
    expect(old.sources[0]?.stopped).toBe(true)
    expect(ended).toHaveBeenCalledOnce()

    stopPlayback()
    expect(ended).toHaveBeenCalledOnce()
  })

  it('still loading, never starts and says it is over', async () => {
    const { audioContext, old, ended, playing } = await tootLoading('hidden')

    setVisibility('visible')
    audioContext()
    old.finishClose()
    old.decodes[0]?.()
    await playing
    expect(old.sources).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
  })

  it('still loading when its close begins, never starts though the close has not settled', async () => {
    const { audioContext, old, ended, playing } = await tootLoading('hidden')

    setVisibility('visible')
    audioContext()
    expect(old.state).not.toBe('closed')
    old.decodes[0]?.()
    await playing
    expect(old.sources).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
    old.finishClose()
  })

  it('stopped while its context is suspended, says it is over once, and the close adds nothing', async () => {
    const { audioContext, stopPlayback, old, ended } = await tootPlaying('visible')

    setVisibility('hidden')
    old.suspend()
    stopPlayback()
    expect(old.sources[0]?.stopped).toBe(true)
    setVisibility('visible')
    expect(audioContext()).not.toBe(old)
    old.finishClose()
    expect(ended).toHaveBeenCalledOnce()

    old.sources[0]?.onended?.()
    expect(ended).toHaveBeenCalledOnce()
  })
})
