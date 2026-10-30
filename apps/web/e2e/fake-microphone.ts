import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'

// A microphone a spec controls: it plays a fart as the person presses Record, so the fart starts
// with the tap, after the app's microphone is open, as a person's does. Chromium's own fake
// microphone (`withFakeMicrophone`) plays its file from the moment the stream opens, before the
// app captures: on CI a take lost the first 60 ms of it (#141). getUserMedia is slowed to 800 ms
// here, about what an iPhone takes, so a tap that waited for it would show.

/**
 * The farts the microphone can play, by fixture id. 090 is Melodic, with golden Recording Pitch
 * G3. 095 (F2), 017 (D♯2), 022 (E2) and 002 (A♯2) unlock Mary Had a Little Lamb (see compose.spec).
 */
const fixtures: Record<string, string> = {
  '090': '090__carlosramon__17-pet__186119.wav',
  '095': '095__breviceps__fart-1__445998.mp3',
  '017': '017__breviceps__fart-3__446000.mp3',
  '022': '022__smokevhstapes__fart-wav__177050.mp3',
  '002': '002__frenkfurth__wav-fart-vegan-026-wav__650671.mp3'
}
/** How long each take records after the press, in ms: about a second longer than its file. */
const takeMs: Record<string, number> = {
  '090': 1500,
  '095': 1800,
  '017': 1900,
  '022': 3000,
  '002': 5250
}
export const getUserMediaMs = 800
/** How long the person holds the button: they start to fart as they press, and click on release. */
const pressMs = 150

export type FakeMicrophone = {
  /** getUserMedia calls, and the tracks they gave out. */
  calls: number
  tracks: MediaStreamTrack[]
  /** When each Record click and each capture batch happened (`performance.now()`). */
  clicks: number[]
  batches: number[]
  /** The fixture id the next press on Record plays into the microphone, and its gain. */
  fartOnPress: string | null
  fartGain: number
  /** The last fart's energy (sum of squares) and loudest sample, as the microphone played it. */
  fartEnergy: number
  fartPeak: number
  /** Capture worklet nodes made, and how many were told to close or to empty their ring. */
  nodes: number
  closed: number
  flushed: number
  /** For each capture worklet node, the ms from the last getUserMedia answer until it was made. */
  processorMs: number[]
  /** Each audio session type the app set, in order (a stand-in for Safari's `audioSession`). */
  sessions: string[]
}

export const microphone = (page: Page) =>
  page.evaluate(() => {
    const mic = (window as unknown as { pedosMic: FakeMicrophone }).pedosMic
    return {
      calls: mic.calls,
      opened: mic.tracks.length,
      live: mic.tracks.filter(track => track.readyState === 'live').length,
      clicks: mic.clicks,
      batches: mic.batches,
      fartEnergy: mic.fartEnergy,
      fartPeak: mic.fartPeak,
      nodes: mic.nodes,
      closed: mic.closed,
      flushed: mic.flushed,
      processorMs: mic.processorMs,
      sessions: mic.sessions
    }
  })

/**
 * Waits until the app's microphone is open: its capture processor runs, so a press captures at
 * once with its pre-roll and an interruption is heard. getUserMedia answering isn't enough: the
 * app loads the processor after it, and on CI that took hundreds of ms (#172).
 */
export async function waitForOpenMicrophone(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const mic = await microphone(page)
      return mic.nodes - mic.closed
    })
    .toBe(1)
}

/**
 * Replaces the microphone with one that answers after `delayMs` and plays a fixture when the
 * person presses Record. It also times each Record click and each batch from the capture worklet,
 * counts the worklet nodes and what they're told, and records the audio session the app sets.
 */
export function fakeMicrophone({
  wavs,
  delayMs
}: {
  wavs: Record<string, string>
  delayMs: number
}) {
  const mic: FakeMicrophone = {
    calls: 0,
    tracks: [],
    clicks: [],
    batches: [],
    fartOnPress: null,
    fartGain: 1,
    fartEnergy: 0,
    fartPeak: 0,
    nodes: 0,
    closed: 0,
    flushed: 0,
    processorMs: [],
    sessions: []
  }
  const page = window as unknown as { pedosMic: FakeMicrophone; pedosMediaDevices: MediaDevices }
  page.pedosMic = mic
  // WebKit's garbage collector drops a `navigator.mediaDevices` wrapper nothing holds, and the
  // replaced getUserMedia with it. Holding it keeps the fake.
  page.pedosMediaDevices = navigator.mediaDevices
  let context: AudioContext | null = null
  let output: MediaStreamAudioDestinationNode | null = null
  const farts: Record<string, AudioBuffer> = {}
  let answeredAt = 0

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
    await new Promise(done => setTimeout(done, delayMs))
    context ??= new AudioContext()
    output ??= context.createMediaStreamDestination()
    for (const [id, wav] of Object.entries(wavs)) {
      if (farts[id]) continue
      const bytes = Uint8Array.from(atob(wav), c => c.charCodeAt(0))
      farts[id] = await context.decodeAudioData(bytes.buffer)
    }
    // A new track per call, as a real microphone gives.
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
      if (fart) {
        mic.fartOnPress = null
        const level = context.createGain()
        level.gain.value = mic.fartGain
        mic.fartGain = 1
        const samples = fart.getChannelData(0)
        mic.fartEnergy = samples.reduce((sum, v) => sum + v * v, 0) * level.gain.value ** 2
        mic.fartPeak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0) * level.gain.value
        const source = context.createBufferSource()
        source.buffer = fart
        source.connect(level).connect(output)
        source.start()
      }
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

  const Native = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Native {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args)
      mic.nodes += 1
      mic.processorMs.push(performance.now() - answeredAt)
      this.port.addEventListener('message', () => mic.batches.push(performance.now()))
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

/** Every fixture the fake microphone can play, as base64. */
export function fixtureWavs(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([id, file]) => [
      id,
      readFileSync(resolve(__dirname, '../../../fixtures/recordings', file)).toString('base64')
    ])
  )
}

/**
 * Presses Record, playing fixture `id` from the press, `gainDb` from its own level, and clicks on
 * release.
 */
export async function fartAndRecord(page: Page, id = '090', { gainDb = 0 } = {}): Promise<void> {
  await page.evaluate(
    ({ fart, gain }) => {
      const mic = (window as unknown as { pedosMic: FakeMicrophone }).pedosMic
      mic.fartOnPress = fart
      mic.fartGain = gain
    },
    { fart: id, gain: 10 ** (gainDb / 20) }
  )
  const box = await page.getByTestId('record-button').boundingBox()
  if (!box) throw new Error('No Record button')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(pressMs)
  await page.mouse.up()
  await expect(page.getByTestId('stop-button')).toBeVisible()
  await page.waitForTimeout(takeMs[id])
  await page.getByTestId('stop-button').click()
  await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
}

/** The newest saved Recording's audio, as samples, from the app's IndexedDB. */
export function savedTake(page: Page): Promise<{ samples: number[]; sampleRate: number }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    const all = await new Promise<ArrayBuffer[]>((done, fail) => {
      const request = database.transaction('audio').objectStore('audio').getAll()
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    database.close()
    const wav = new DataView(all[all.length - 1])
    const sampleRate = wav.getUint32(24, true)
    let at = 12
    while (String.fromCharCode(...new Uint8Array(wav.buffer, at, 4)) !== 'data') {
      at += 8 + wav.getUint32(at + 4, true)
    }
    const length = wav.getUint32(at + 4, true) / 2
    const samples = Array.from({ length }, (_, i) => wav.getInt16(at + 8 + 2 * i, true) / 0x8000)
    return { samples, sampleRate }
  })
}
