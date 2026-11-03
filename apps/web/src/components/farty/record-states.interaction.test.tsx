import '@/test-support/app-providers'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Take } from '@/lib/audio/recorder'
import type { PcmAudio } from '@/lib/wav'
import { closeScreens, show } from '@/test-support/screen'

const sampleRate = 48000

function standInTake() {
  const batches: Float32Array[] = []
  let listener: ((batch: Float32Array) => void) | null = null
  let finish: (() => void) | null = null
  const take: Take = {
    sampleRate,
    listen(next) {
      for (const batch of batches) next(batch)
      listener = next
    },
    stop: vi.fn(
      () =>
        new Promise<PcmAudio>(resolve => {
          finish = () => {
            const samples = new Float32Array(batches.reduce((n, b) => n + b.length, 0))
            let at = 0
            for (const batch of batches) {
              samples.set(batch, at)
              at += batch.length
            }
            resolve({ samples, sampleRate })
          }
        })
    ),
    cancel: vi.fn()
  }
  return {
    take,
    send(batch: Float32Array) {
      batches.push(batch)
      listener?.(batch)
    },
    finish: () => finish?.()
  }
}

const mic = vi.hoisted(() => ({
  startTake: vi.fn(),
  reportError: vi.fn()
}))

vi.mock('@/lib/audio/recorder', () => ({ startTake: mic.startTake }))
vi.mock('@/lib/analysis/client', () => ({ analyze: () => new Promise(() => {}) }))
vi.mock('@/lib/recording-store', () => ({
  onWaitingForOtherTabs: () => () => {},
  loadRecordings: async () => []
}))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: mic.reportError }))
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedOut' }, offerStep: () => false })
}))

const { FartyProvider } = await import('./farty-provider')
const { hintAfterMs } = await import('./take-capture')
const { RecordScreen } = await import('./record-screen')
const { RecordFlow } = await import('./record-flow')

function room(length: number, db = -80): Float32Array {
  const amplitude = 10 ** (db / 20) * Math.sqrt(3)
  let seed = 7
  return Float32Array.from({ length }, () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return amplitude * (2 * (seed / 2 ** 31) - 1)
  })
}

function fart(length: number, db = -20): Float32Array {
  const amplitude = 10 ** (db / 20)
  return Float32Array.from(
    { length },
    (_, i) => amplitude * Math.sin((2 * Math.PI * 120 * i) / sampleRate)
  )
}

const firstBatch = Math.round(0.3 * sampleRate) + 128
const batchFrames = 4096
const batchMs = (batchFrames / sampleRate) * 1000

let starting: { resolve: (take: Take) => void; interrupt: () => void } | null = null

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
  })
  mic.startTake.mockImplementation(
    (onInterrupted: () => void) =>
      new Promise<Take>(resolve => {
        starting = { resolve, interrupt: onInterrupted }
      })
  )
})

afterEach(() => {
  closeScreens()
  starting = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  Reflect.deleteProperty(window.navigator, 'vibrate')
})

function stubVibrate() {
  const vibrate = vi.fn(() => true)
  Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate })
  return vibrate
}

async function open() {
  await show(
    <FartyProvider>
      <RecordScreen />
      <RecordFlow />
    </FartyProvider>
  )
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const level = () => Number(byTestId('live-waveform')?.dataset.level)
const bars = () => Number(byTestId('live-waveform')?.dataset.bars)
const hint = () => byTestId('recording-hint')?.textContent ?? ''
const timer = () => byTestId('recording-timer')?.textContent
const dialog = () => document.querySelector('[role="dialog"]')?.getAttribute('aria-label')

async function tapRecord() {
  const button = byTestId('record-button')
  if (!button) throw new Error('no Record button')
  await act(async () => button.click())
}

async function startRecording(first: Float32Array = room(firstBatch)) {
  await tapRecord()
  const stand = standInTake()
  stand.send(first)
  await act(async () => starting?.resolve(stand.take))
  return stand
}

async function sendFor(
  stand: ReturnType<typeof standInTake>,
  ms: number,
  batch: () => Float32Array
) {
  for (let sent = 0; sent < ms; sent += batchMs) {
    await act(async () => {
      stand.send(batch())
      vi.advanceTimersByTime(batchMs)
    })
  }
}

describe('Record’s states (#281, #314)', () => {
  it('shows Getting the mic ready until the take’s audio comes in, and only then turns red', async () => {
    const vibrate = stubVibrate()
    await open()
    const shown: string[] = []
    const seen = new MutationObserver(() => {
      const state = byTestId('recording-screen')?.dataset.state
      if (state && shown[shown.length - 1] !== state) shown.push(state)
    })
    seen.observe(document.body, { subtree: true, childList: true, attributes: true })

    await tapRecord()
    expect(dialog()).toBe('Getting the mic ready')
    expect(byTestId('record-getting-ready')?.textContent).toContain('Getting the mic ready…')
    expect(byTestId('record-getting-ready')?.textContent).toContain(
      "The screen turns red when it's recording."
    )
    expect(byTestId('recording-screen')).toBeNull()
    expect(byTestId('stop-button')).toBeNull()
    expect(byTestId('recording-timer')).toBeNull()
    expect(byTestId('live-waveform')).toBeNull()
    expect((byTestId('record-button') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => vi.advanceTimersByTime(1500))
    expect(byTestId('record-getting-ready')).not.toBeNull()
    expect(byTestId('recording-screen')).toBeNull()
    expect(shown).toEqual([])
    expect(vibrate).not.toHaveBeenCalled()

    const stand = standInTake()
    stand.send(room(firstBatch))
    await act(async () => starting?.resolve(stand.take))
    expect(dialog()).toBe('Recording')
    expect(byTestId('record-getting-ready')).toBeNull()
    const screen = byTestId('recording-screen')
    expect(screen?.dataset.state).toBe('recording')
    expect(screen?.textContent).toContain('Recording')
    expect(screen?.closest('[role="dialog"]')?.className).toContain('bg-record-screen')
    const stop = byTestId('stop-button')
    expect(stop?.dataset.state).toBe('recording')
    expect(stop?.getAttribute('aria-label')).toBe('Stop')
    expect((stop as HTMLButtonElement).disabled).toBe(false)
    expect(timer()).toBe('0:00.0')
    expect(hint()).toBe('')
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(40)
    seen.disconnect()
    expect(shown).toEqual(['recording'])
  })

  it('never turns red, or buzzes, when the microphone fails to start', async () => {
    const vibrate = stubVibrate()
    await open()
    await tapRecord()
    expect(byTestId('record-getting-ready')).not.toBeNull()
    await act(async () => {
      starting?.resolve(Promise.reject(new Error('no audio')) as unknown as Take)
    })
    expect(byTestId('recording-screen')).toBeNull()
    expect(byTestId('record-getting-ready')).toBeNull()
    expect(document.body.textContent).toContain("Couldn't start recording")
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('counts the timer in tenths', async () => {
    await open()
    await startRecording()
    await act(async () => vi.advanceTimersByTime(1250))
    expect(timer()).toBe('0:01.2')
    await act(async () => vi.advanceTimersByTime(23_400 - 1250))
    expect(timer()).toBe('0:23.4')
  })

  it('draws the take’s waveform live: a bar per 50 ms, tall for the fart, flat for the room', async () => {
    await open()
    const stand = await startRecording()
    expect(bars()).toBe(6)
    expect(level()).toBe(0)

    await act(async () => stand.send(fart(batchFrames, -20)))
    expect(bars()).toBeGreaterThan(6)
    const loud = level()
    expect(loud).toBeGreaterThan(0.6)
    expect(loud).toBeLessThan(0.8)

    await act(async () => stand.send(fart(batchFrames, -50)))
    await act(async () => stand.send(fart(batchFrames, -50)))
    const quieter = level()
    expect(quieter).toBeGreaterThan(0.2)
    expect(quieter).toBeLessThan(loud)

    await act(async () => stand.send(room(batchFrames)))
    await act(async () => stand.send(room(batchFrames)))
    expect(level()).toBe(0)
    expect(bars()).toBe(Math.floor((firstBatch + 5 * batchFrames) / (0.05 * sampleRate)))
  })

  it('says it can’t hear anything after 2 s of room, without stopping the take', async () => {
    await open()
    const stand = await startRecording()
    await sendFor(stand, hintAfterMs - 200, () => room(batchFrames))
    expect(hint()).toBe('')

    await sendFor(stand, 300, () => room(batchFrames))
    expect(hint()).toBe("Can't hear anything. Move closer.")
    expect(stand.take.stop).not.toHaveBeenCalled()
    expect(stand.take.cancel).not.toHaveBeenCalled()
    expect(byTestId('stop-button')?.dataset.state).toBe('recording')

    await sendFor(stand, 300, () => fart(batchFrames))
    expect(hint()).toBe('')
    expect(timer()).toBe('0:02.5')
  })

  it('agrees with Stop: a take it can’t hear is the one Stop refuses', async () => {
    await open()
    const stand = await startRecording()
    await sendFor(stand, hintAfterMs + 500, () => room(batchFrames))
    expect(hint()).not.toBe('')

    await act(async () => byTestId('stop-button')?.click())
    await act(async () => stand.finish())
    expect(byTestId('record-status')?.textContent).toBe("Didn't catch that. Try again.")
    expect(byTestId('stop-button')).toBeNull()
  })

  it('never hints at a take it hears, and Stop keeps it', async () => {
    await open()
    const stand = await startRecording()
    await sendFor(stand, 500, () => room(batchFrames))
    await sendFor(stand, 300, () => fart(batchFrames))
    await sendFor(stand, hintAfterMs, () => room(batchFrames))
    expect(hint()).toBe('')

    await act(async () => byTestId('stop-button')?.click())
    await act(async () => stand.finish())
    expect(byTestId('record-status')?.textContent).toBe('')
    expect(byTestId('review-play')).not.toBeNull()
  })

  it('dims Stop and holds the timer and waveform while the take finishes after Stop', async () => {
    await open()
    const stand = await startRecording()
    await sendFor(stand, 3100, () => fart(batchFrames))
    expect(timer()).toBe('0:03.1')
    const drawn = bars()

    await act(async () => byTestId('stop-button')?.click())
    const stop = byTestId('stop-button')
    expect(stop?.dataset.state).toBe('finishing')
    expect((stop as HTMLButtonElement).disabled).toBe(true)
    expect(byTestId('recording-screen')?.dataset.state).toBe('finishing')
    expect(hint()).toBe('')

    await act(async () => vi.advanceTimersByTime(3000))
    expect(timer()).toBe('0:03.1')
    expect(bars()).toBe(drawn)

    await act(async () => stand.finish())
    expect(byTestId('stop-button')).toBeNull()
    expect(byTestId('recording-screen')).toBeNull()
  })

  it('lets an interrupted take go: no waveform and no hint carry over to the next', async () => {
    await open()
    const timers = vi.spyOn(window, 'setTimeout')
    const cleared = vi.spyOn(window, 'clearTimeout')
    const hum = (length: number) => fart(length, -50)
    const first = await startRecording(hum(firstBatch))
    await sendFor(first, 1000, () => hum(batchFrames))
    expect(level()).toBeGreaterThan(0)
    await act(async () => starting?.interrupt())
    expect(document.body.textContent).toContain('Recording stopped')
    expect(byTestId('stop-button')).toBeNull()
    const hintTimer =
      timers.mock.results[timers.mock.calls.findIndex(([, ms]) => ms === hintAfterMs)]
    expect(hintTimer?.value).toBeDefined()
    expect(cleared).toHaveBeenCalledWith(hintTimer?.value)

    await tapRecord()
    expect(byTestId('live-waveform')).toBeNull()
    const second = standInTake()
    await act(async () => starting?.resolve(second.take))
    expect(byTestId('stop-button')?.dataset.state).toBe('recording')
    expect(bars()).toBe(0)
    expect(level()).toBe(0)

    const hints: string[] = []
    for (let sent = 0; sent < hintAfterMs + 500; sent += batchMs) {
      await act(async () => {
        second.send(sent < 500 ? room(batchFrames) : fart(batchFrames))
        vi.advanceTimersByTime(batchMs)
      })
      hints.push(hint())
    }
    expect(hints.every(h => h === '')).toBe(true)
    expect(byTestId('stop-button')?.dataset.state).toBe('recording')
  })
})
