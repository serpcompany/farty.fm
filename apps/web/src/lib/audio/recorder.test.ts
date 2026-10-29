import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorName } from '@/lib/telemetry/report'
import { stubMicrophoneBrowser, microphoneWorld as world } from '@/test-support/fake-microphone'

async function recorder() {
  vi.resetModules()
  return import('./recorder')
}

beforeEach(() => {
  vi.useFakeTimers()
  stubMicrophoneBrowser()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function tapRecord(startTake: (onInterrupted: () => void) => Promise<unknown>) {
  const started = startTake(() => {}).then(
    take => ({ take, error: null }),
    (error: Error) => ({ take: null, error })
  )
  await vi.advanceTimersByTimeAsync(3500)
  return started
}

describe('a take whose pipeline sends no audio', () => {
  it('opens a fresh stream on the next tap when the stream fed the graph nothing', async () => {
    const { startTake } = await recorder()
    world.breakNext = stream => {
      stream.feeds = false
    }
    const first = await tapRecord(startTake)
    expect(first.error?.message).toBe('No audio from the microphone')
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockRan')

    world.breakNext = null
    const second = await tapRecord(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(world.streams[0].track.readyState).toBe('ended')
  })

  it('starts a fresh context on the next tap when the context’s clock stopped', async () => {
    const { startTake } = await recorder()
    world.breakNext = (_, context) => {
      context.renders = false
    }
    const first = await tapRecord(startTake)
    expect(first.error?.message).toBe('No audio from the microphone')
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockStopped')

    world.breakNext = null
    const second = await tapRecord(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(world.contexts).toHaveLength(2)
    expect(world.contexts[0].state).toBe('closed')
  })

  it('keeps the microphone and context when the take starts', async () => {
    const { startTake } = await recorder()
    const first = (await tapRecord(startTake)) as { take: { cancel(): void } | null }
    expect(first.take).not.toBeNull()
    first.take?.cancel()
    const second = await tapRecord(startTake)
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(world.contexts).toHaveLength(1)
  })
})
