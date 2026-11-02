import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Take } from '@/lib/audio/recorder'
import type { PcmAudio } from '@/lib/wav'

// Record's states in a DOM, with the real PedosProvider and a stand-in microphone (#281, #314):
// the grey "Getting the mic ready" screen until the take's audio comes in, then the red Recording
// screen with a timer in tenths and the waveform its batches draw, the "Can't hear anything" hint
// that agrees with Stop's verdict, and finishing after Stop.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sampleRate = 48000

/** A take whose batches the test sends, as the capture node would. */
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
    /** Lets `stop()` resolve with the take. */
    finish: () => finish?.()
  }
}

const mic = vi.hoisted(() => ({
  startTake: vi.fn(),
  reportError: vi.fn()
}))

vi.mock('@/lib/audio/recorder', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/audio/recorder')>()
  return {
    MicrophoneDeniedError: real.MicrophoneDeniedError,
    MicrophoneReleasedError: real.MicrophoneReleasedError,
    startTake: mic.startTake,
    keepMicrophoneOpen: () => undefined
  }
})
vi.mock('@/lib/analysis/client', () => ({ analyze: () => new Promise(() => {}) }))
vi.mock('@/lib/analysis-upgrade', () => ({ upgradeAnalyses: async () => {} }))
vi.mock('@/lib/audio/player', () => ({
  forgetDecoded: () => undefined,
  play: async () => {},
  playbackPosition: () => null,
  stopPlayback: () => undefined
}))
vi.mock('@/lib/audio/context', () => ({ startAudioInTap: () => undefined }))
vi.mock('@/lib/library-sync', () => ({
  onLibraryChanged: () => () => {},
  recordingsAfter: (list: unknown) => list
}))
vi.mock('@/lib/recording-store', () => ({
  onWaitingForOtherTabs: () => () => {},
  loadRecordings: async () => []
}))
vi.mock('@/lib/toot-store', () => ({ loadToots: async () => [] }))
vi.mock('@/lib/toot-renderer', () => ({ makeToot: () => new Promise(() => {}) }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/stale-build', () => ({ holdReload: () => () => {} }))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: mic.reportError }))
vi.mock('./account-provider', () => ({ useAccount: () => ({ offerStep: () => false }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({}), usePathname: () => '/' }))

const { PedosProvider, hintAfterMs } = await import('./pedos-provider')
const { RecordScreen } = await import('./record-screen')
const { RecordFlow } = await import('./record-flow')

/** Steady room noise at about `db` dBFS, from a fixed seed. */
function room(length: number, db = -80): Float32Array {
  const amplitude = 10 ** (db / 20) * Math.sqrt(3)
  let seed = 7
  return Float32Array.from({ length }, () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return amplitude * (2 * (seed / 2 ** 31) - 1)
  })
}

/** A fart-loud tone peaking at `db` dBFS. */
function fart(length: number, db = -20): Float32Array {
  const amplitude = 10 ** (db / 20)
  return Float32Array.from(
    { length },
    (_, i) => amplitude * Math.sin((2 * Math.PI * 120 * i) / sampleRate)
  )
}

/** The capture node's first batch: the pre-roll and one quantum. */
const firstBatch = Math.round(0.3 * sampleRate) + 128
const batchFrames = 4096
const batchMs = (batchFrames / sampleRate) * 1000

let root: Root | null = null
/** The take being started: `resolve` lets the microphone start, `interrupt` loses it. */
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

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  starting = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function open() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <PedosProvider>
        <RecordScreen />
        <RecordFlow />
      </PedosProvider>
    )
  )
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
/** The live waveform's newest bar, and how many bars it has drawn. */
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

/** Taps Record and lets the microphone start, its first batch (`first`) already in. */
async function startRecording(first: Float32Array = room(firstBatch)) {
  await tapRecord()
  const stand = standInTake()
  stand.send(first)
  await act(async () => starting?.resolve(stand.take))
  return stand
}

/** Sends `ms` of batches as they'd come in, the timers moving with them. */
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
    const vibrate = vi.fn(() => true)
    Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate })
    await open()
    // Never red before the audio: watched on every change to the page, not only at the checks.
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

    // The microphone takes its time: still getting ready, and no buzz yet.
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
    // The phone buzzes once, as it turns red.
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(40)
    seen.disconnect()
    expect(shown).toEqual(['recording'])
    Reflect.deleteProperty(window.navigator, 'vibrate')
  })

  it('never turns red when the microphone fails to start', async () => {
    await open()
    await tapRecord()
    expect(byTestId('record-getting-ready')).not.toBeNull()
    await act(async () => {
      // A start that fails before any audio: the stand-in rejects as `startTake` would.
      starting?.resolve(Promise.reject(new Error('no audio')) as unknown as Take)
    })
    expect(byTestId('recording-screen')).toBeNull()
    expect(byTestId('record-getting-ready')).toBeNull()
    expect(document.body.textContent).toContain("Couldn't start recording")
  })

  it('counts the timer in tenths', async () => {
    await open()
    await startRecording()
    await act(async () => vi.advanceTimersByTime(1250))
    expect(timer()).toBe('0:01.2')
    // Up to the 30 s limit.
    await act(async () => vi.advanceTimersByTime(23_400 - 1250))
    expect(timer()).toBe('0:23.4')
  })

  it('draws the take’s waveform live: a bar per 50 ms, tall for the fart, flat for the room', async () => {
    await open()
    const stand = await startRecording()
    // The first batch, 0.3 s of pre-roll: six bars, and the room under the -70 dBFS floor draws
    // them flat.
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
    // The bars so far, in order: 0.3 s of pre-roll and five batches.
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

    // A fart comes in: the hint goes, and the take carries on.
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
    // A steady hum: it shows a level, but with no contrast it's a take Stop would refuse.
    const hum = (length: number) => fart(length, -50)
    const first = await startRecording(hum(firstBatch))
    // About 1 s in, a call takes the microphone.
    await sendFor(first, 1000, () => hum(batchFrames))
    expect(level()).toBeGreaterThan(0)
    await act(async () => starting?.interrupt())
    expect(document.body.textContent).toContain('Recording stopped')
    expect(byTestId('stop-button')).toBeNull()
    // The take's 2 s hint timer is cleared with it.
    const hintTimer =
      timers.mock.results[timers.mock.calls.findIndex(([, ms]) => ms === hintAfterMs)]
    expect(hintTimer?.value).toBeDefined()
    expect(cleared).toHaveBeenCalledWith(hintTimer?.value)

    // Recording again straight away. This take has sent nothing yet, so the waveform it shows is
    // what the lost take left: nothing.
    await tapRecord()
    expect(byTestId('live-waveform')).toBeNull()
    const second = standInTake()
    await act(async () => starting?.resolve(second.take))
    expect(byTestId('stop-button')?.dataset.state).toBe('recording')
    expect(bars()).toBe(0)
    expect(level()).toBe(0)

    // The lost take's 2 s hint, 1 s from now, would say it hears nothing. This take hears room,
    // then a fart, so its own never does.
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
