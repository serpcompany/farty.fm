import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorName } from '@/lib/telemetry/report'
import { captureSampleRate } from '@/test-support/capture-processor'
import { stubMicrophoneBrowser, microphoneWorld as world } from '@/test-support/fake-microphone'
import type { Take } from './recorder'

class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

let page = new FakePage()
let pageWindow = new EventTarget()

function hide(how: 'background' | 'pagehide' = 'background') {
  page.visibilityState = 'hidden'
  page.dispatchEvent(new Event('visibilitychange'))
  if (how === 'pagehide') pageWindow.dispatchEvent(new Event('pagehide'))
  for (const stream of world.streams) {
    if (stream.track.readyState !== 'live') continue
    stream.track.muted = true
    stream.track.onmute?.()
  }
  for (const context of world.contexts) {
    context.renders = false
    if (context.state !== 'running') continue
    context.state = 'suspended'
    context.dispatchEvent(new Event('statechange'))
  }
}

function show() {
  page.visibilityState = 'visible'
  page.dispatchEvent(new Event('visibilitychange'))
  for (const stream of world.streams) {
    if (stream.track.readyState !== 'live') continue
    stream.track.muted = false
    stream.track.onunmute?.()
  }
}

async function recorder() {
  vi.resetModules()
  const [take, keeping] = await Promise.all([
    import('./recorder'),
    import('./keep-microphone-open')
  ])
  return { ...take, ...keeping }
}

beforeEach(() => {
  vi.useFakeTimers()
  page = new FakePage()
  pageWindow = Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  })
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', pageWindow)
  stubMicrophoneBrowser()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type StartTake = (
  onInterrupted: () => void,
  onRetry?: (error: Error) => void
) => Promise<{ cancel(): void }>

async function tapRecord(startTake: StartTake, ms = 3500, onRetry?: (error: Error) => void) {
  let result: { take: { cancel(): void } | null; error: Error | null } = {
    take: null,
    error: null
  }
  startTake(() => {}, onRetry).then(
    take => {
      result = { take, error: null }
    },
    (error: Error) => {
      result = { take: null, error }
    }
  )
  await vi.advanceTimersByTimeAsync(ms)
  return result
}

describe('the first tap on Record after opening the app', () => {
  it('records at once after the app was in the background, keeping the stream', async () => {
    const { startTake, keepMicrophoneOpen } = await recorder()
    keepMicrophoneOpen()
    const first = await tapRecord(startTake)
    expect(first.take).not.toBeNull()
    first.take?.cancel()

    hide()
    await vi.advanceTimersByTimeAsync(30_000)
    show()
    await vi.advanceTimersByTimeAsync(1000)
    const back = await tapRecord(startTake, 500)
    expect(back.error).toBeNull()
    expect(back.take).not.toBeNull()
    expect(world.contexts).toHaveLength(2)
    expect(world.contexts[0].state).toBe('closed')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
  })

  it('records at once in a tab opened again from the back-forward cache', async () => {
    const { startTake, keepMicrophoneOpen } = await recorder()
    keepMicrophoneOpen()
    const first = await tapRecord(startTake)
    first.take?.cancel()

    hide('pagehide')
    await vi.advanceTimersByTimeAsync(5000)
    show()
    await vi.advanceTimersByTimeAsync(1000)
    const back = await tapRecord(startTake, 500)
    expect(back.error).toBeNull()
    expect(back.take).not.toBeNull()
    expect(world.contexts[0].state).toBe('closed')
    expect(world.contexts.at(-1)?.state).toBe('running')
  })

  it('keeps the microphone and context between takes while the page shows', async () => {
    const { startTake } = await recorder()
    const first = await tapRecord(startTake)
    expect(first.take).not.toBeNull()
    first.take?.cancel()
    const second = await tapRecord(startTake)
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(world.contexts).toHaveLength(1)
  })
})

describe('a take whose context’s clock stands still', () => {
  it('tries once more by itself, on a fresh stream and context, and records', async () => {
    const { startTake } = await recorder()
    world.breakNext = (_, context) => {
      context.renders = false
      world.breakNext = null
    }
    const onRetry = vi.fn()
    const first = await tapRecord(startTake, 5000, onRetry)
    expect(first.error).toBeNull()
    expect(first.take).not.toBeNull()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(errorName(onRetry.mock.calls[0][0].name)).toBe('NoAudioRunningClockStopped')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(world.contexts).toHaveLength(2)
    expect(world.contexts[0].state).toBe('closed')
  })

  it('says it couldn’t start when the second try stands still too, and the next tap records', async () => {
    const { startTake } = await recorder()
    world.breakNext = (_, context) => {
      context.renders = false
    }
    const onRetry = vi.fn()
    const first = await tapRecord(startTake, 8000, onRetry)
    expect(first.error?.message).toBe('No audio from the microphone')
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockStopped')
    expect(onRetry).toHaveBeenCalledOnce()

    world.breakNext = null
    const second = await tapRecord(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(world.contexts).toHaveLength(3)
  })
})

describe('a take whose stream feeds the graph nothing', () => {
  it('opens a fresh stream on the next tap, without trying again by itself', async () => {
    const { startTake } = await recorder()
    world.breakNext = stream => {
      stream.feeds = false
    }
    const onRetry = vi.fn()
    const first = await tapRecord(startTake, 3500, onRetry)
    expect(first.error?.message).toBe('No audio from the microphone')
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockRan')
    expect(onRetry).not.toHaveBeenCalled()

    world.breakNext = null
    const second = await tapRecord(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(world.streams[0].track.readyState).toBe('ended')
  })
})

describe('a take’s batches, which feed Record’s level (#281)', () => {
  it('reach its listener from the first, with the pre-roll, as the take keeps them', async () => {
    const { startTake } = await recorder()
    ;(await tapRecord(startTake)).take?.cancel()
    let take: Take | null = null
    void startTake(() => {}).then(started => {
      take = started
    })
    await vi.advanceTimersByTimeAsync(500)
    const started = take as Take | null
    if (!started) throw new Error('The take didn’t start')
    expect(started.sampleRate).toBe(captureSampleRate)

    const heard: Float32Array[] = []
    started.listen(batch => heard.push(batch))
    const soFar = heard.length
    expect(soFar).toBeGreaterThan(0)
    expect(heard[0].length).toBeGreaterThan(0.25 * captureSampleRate)
    await vi.advanceTimersByTimeAsync(1000)
    expect(heard.length).toBeGreaterThan(soFar)
    expect(heard.slice(soFar).every(batch => batch.length === 4096)).toBe(true)

    const stopping = started.stop()
    await vi.advanceTimersByTimeAsync(10)
    const audio = await stopping
    expect(heard.reduce((sum, batch) => sum + batch.length, 0)).toBe(audio.samples.length)
  })
})
