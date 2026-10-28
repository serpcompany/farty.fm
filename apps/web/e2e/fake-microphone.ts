import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { skipWelcome } from './record'
import { expect, test } from './test'

const fixtures: Record<string, string> = {
  '090': '090__carlosramon__17-pet__186119.wav',
  '095': '095__breviceps__fart-1__445998.mp3',
  '017': '017__breviceps__fart-3__446000.mp3',
  '022': '022__smokevhstapes__fart-wav__177050.mp3',
  '002': '002__frenkfurth__wav-fart-vegan-026-wav__650671.mp3'
}

export const getUserMediaMs = 800
const pressSeconds = 0.15
const takeBeyondFartSeconds = 1.3

type FakeMicrophone = {
  calls: number
  calledAt: number[]
  tracks: MediaStreamTrack[]
  clicks: number[]
  batches: number[]
  fartOnPress: string | null
  fartEnergy: number
  fartSeconds: number
  fartPlayedSeconds: () => number
  take: { id: number; seconds: number }
  nodes: number
  closed: number
  flushed: number
  processorLoads: number
  processorMs: number[]
  sessions: string[]
}

declare global {
  interface Window {
    fartyMic: FakeMicrophone
  }
}

export const microphone = (page: Page) =>
  page.evaluate(() => {
    const mic = window.fartyMic
    return {
      calls: mic.calls,
      calledAt: mic.calledAt,
      opened: mic.tracks.length,
      live: mic.tracks.filter(track => track.readyState === 'live').length,
      clicks: mic.clicks,
      batches: mic.batches,
      fartEnergy: mic.fartEnergy,
      nodes: mic.nodes,
      closed: mic.closed,
      flushed: mic.flushed,
      processorLoads: mic.processorLoads,
      processorMs: mic.processorMs,
      sessions: mic.sessions
    }
  })

export async function waitForOpenMicrophone(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const mic = await microphone(page)
      return mic.nodes - mic.closed
    })
    .toBe(1)
}

export function fakeMicrophone({
  wavs,
  delayMs
}: {
  wavs: Record<string, string>
  delayMs: number
}) {
  let context: AudioContext | null = null
  let output: MediaStreamAudioDestinationNode | null = null
  const farts: Record<string, AudioBuffer> = {}
  let answeredAt = 0
  let fartStartedAt = 0
  const mic: FakeMicrophone = {
    calls: 0,
    calledAt: [],
    tracks: [],
    clicks: [],
    batches: [],
    fartOnPress: null,
    fartEnergy: 0,
    fartSeconds: 0,
    fartPlayedSeconds: () => (context ? context.currentTime - fartStartedAt : 0),
    take: { id: 0, seconds: 0 },
    nodes: 0,
    closed: 0,
    flushed: 0,
    processorLoads: 0,
    processorMs: [],
    sessions: []
  }
  window.fartyMic = mic
  Object.assign(window, { fartyMediaDevices: navigator.mediaDevices })

  let sessionType = 'auto'
  Object.defineProperty(navigator, 'audioSession', {
    configurable: true,
    value: {
      get type() {
        return sessionType
      },
      set type(type: string) {
        sessionType = type
        mic.sessions.push(type)
      }
    }
  })

  navigator.mediaDevices.getUserMedia = async () => {
    mic.calls += 1
    mic.calledAt.push(performance.now())
    await new Promise(done => setTimeout(done, delayMs))
    context ??= new AudioContext()
    output ??= context.createMediaStreamDestination()
    for (const [id, wav] of Object.entries(wavs)) {
      if (farts[id]) continue
      const bytes = Uint8Array.from(atob(wav), c => c.charCodeAt(0))
      farts[id] = await context.decodeAudioData(bytes.buffer)
    }
    const tracks = output.stream.getAudioTracks().map(track => track.clone())
    mic.tracks.push(...tracks)
    answeredAt = performance.now()
    return new MediaStream(tracks)
  }

  const onRecord = (event: Event) =>
    event.target instanceof Element && event.target.closest('[data-testid="record-button"]')
  document.addEventListener(
    'pointerdown',
    event => {
      if (!onRecord(event) || !context || !output) return
      void context.resume()
      const fart = mic.fartOnPress && farts[mic.fartOnPress]
      if (!fart) return
      mic.fartOnPress = null
      mic.fartEnergy = fart.getChannelData(0).reduce((sum, v) => sum + v * v, 0)
      mic.fartSeconds = fart.duration
      const source = context.createBufferSource()
      source.buffer = fart
      source.connect(output)
      source.start()
      fartStartedAt = context.currentTime
    },
    true
  )
  document.addEventListener(
    'click',
    event => {
      if (onRecord(event)) mic.clicks.push(performance.now())
    },
    true
  )

  const addModule = AudioWorklet.prototype.addModule
  AudioWorklet.prototype.addModule = async function (
    this: AudioWorklet,
    ...args: Parameters<AudioWorklet['addModule']>
  ) {
    await addModule.apply(this, args)
    mic.processorLoads += 1
  }

  const Native = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Native {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args)
      mic.nodes += 1
      mic.processorMs.push(performance.now() - answeredAt)
      const sampleRate = this.context.sampleRate
      this.port.addEventListener(
        'message',
        (event: MessageEvent<{ take?: number; samples?: Float32Array }>) => {
          mic.batches.push(performance.now())
          const { take, samples } = event.data ?? {}
          if (typeof take !== 'number' || !samples) return
          if (mic.take.id !== take) mic.take = { id: take, seconds: 0 }
          mic.take.seconds += samples.length / sampleRate
        }
      )
      const post = this.port.postMessage.bind(this.port)
      this.port.postMessage = ((
        message: { type?: string },
        options?: StructuredSerializeOptions
      ) => {
        if (message?.type === 'close') mic.closed += 1
        if (message?.type === 'flush') mic.flushed += 1
        post(message, options)
      }) as MessagePort['postMessage']
    }
  }
}

function fixtureWavs(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([id, file]) => [
      id,
      readFileSync(resolve(__dirname, '../../../fixtures/recordings', file)).toString('base64')
    ])
  )
}

export function withFartingMicrophone({ farts = true, granted = true, welcomed = true } = {}) {
  if (granted) test.use({ permissions: ['microphone'] })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeMicrophone, {
      wavs: farts ? fixtureWavs() : {},
      delayMs: getUserMediaMs
    })
    if (welcomed) await page.addInitScript(skipWelcome)
  })
}

export async function fartAndRecord(page: Page, id = '090'): Promise<void> {
  await page.evaluate(fart => {
    window.fartyMic.fartOnPress = fart
    window.fartyMic.take = { id: -1, seconds: 0 }
  }, id)
  const box = await page.getByTestId('record-button').boundingBox()
  if (!box) throw new Error('No Record button')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect
    .poll(() => page.evaluate(() => window.fartyMic.fartPlayedSeconds()), { intervals: [10] })
    .toBeGreaterThanOrEqual(pressSeconds)
  await page.mouse.up()
  await expect(page.getByTestId('stop-button')).toBeVisible()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const mic = window.fartyMic
          return mic.take.seconds - mic.fartSeconds
        }),
      { intervals: [50], timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(takeBeyondFartSeconds)
  await page.getByTestId('stop-button').click()
  await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
}

export async function fartAndSave(page: Page, id = '090') {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, id)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
  return microphone(page)
}

export async function tapRecord(page: Page, { saysStarting = false } = {}) {
  await page.getByTestId('record-button').click()
  if (saysStarting) await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
  await expect(page.getByTestId('stop-button')).toBeVisible()
  return microphone(page)
}

export async function tapOnSilence(page: Page): Promise<void> {
  await tapRecord(page)
  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
}

export function clickToFirstBatch(clicks: number[], batches: number[]): number[] {
  return clicks.map(at => (batches.find(b => b >= at) ?? Number.POSITIVE_INFINITY) - at)
}

export function lastClickToFirstBatch({
  clicks,
  batches
}: {
  clicks: number[]
  batches: number[]
}) {
  return clickToFirstBatch(clicks, batches).at(-1) ?? Number.POSITIVE_INFINITY
}

export function interrupt(page: Page, type: 'mute' | 'unmute' | 'ended'): Promise<void> {
  return page.evaluate(event => {
    for (const track of window.fartyMic.tracks) track.dispatchEvent(new Event(event))
  }, type)
}
