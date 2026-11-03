import type { PcmAudio } from '@/lib/wav'
import { sendCommand } from './capture-processor'
import {
  type Capturing,
  nextTakeId,
  startCapturing,
  stopCapturing,
  takeInProgress
} from './capturing'
import { audioContext, replaceAudioContext } from './context'
import {
  currentMicrophone,
  interrupted,
  type Microphone,
  MicrophoneReleasedError,
  moveMicrophone,
  openMicrophone,
  releaseMicrophone
} from './microphone'
import { stopPlayback } from './player'

export type Take = {
  stop(): Promise<PcmAudio>
  cancel(): void
  readonly sampleRate: number
  listen(listener: (batch: Float32Array) => void): void
}

class NoMicrophoneAudioError extends Error {
  readonly stoodStill: boolean

  constructor(context: AudioContext, clockAt: number) {
    super('No audio from the microphone')
    const state = String(context.state).replace(/[^a-z]/gi, '')
    const clockRan = context.currentTime > clockAt
    this.stoodStill = context.state === 'running' && !clockRan
    const clock = clockRan ? 'Ran' : 'Stopped'
    this.name = `NoAudio${state.charAt(0).toUpperCase()}${state.slice(1)}Clock${clock}`
  }
}

export const firstBatchTimeoutMs = 3000
const lastBatchTimeoutMs = 500

export async function startTake(
  onInterrupted: () => void,
  onRetry?: (error: NoMicrophoneAudioError) => void
): Promise<Take> {
  startContext()
  try {
    return await startOnce(onInterrupted)
  } catch (error) {
    if (!(error instanceof NoMicrophoneAudioError && error.stoodStill)) throw error
    onRetry?.(error)
    startContext()
    return startOnce(onInterrupted)
  }
}

function startContext(): void {
  audioContext()
    .resume()
    .catch(() => {})
}

async function startOnce(onInterrupted: () => void): Promise<Take> {
  const open = currentMicrophone()
  if (open && !takeInProgress() && interrupted(open)) releaseMicrophone()
  let mic = await openMicrophone()
  if (!takeInProgress()) {
    if (interrupted(mic)) {
      releaseMicrophone()
      mic = await openMicrophone()
    } else if (mic.context !== audioContext()) mic = await moveMicrophone(mic)
  }
  const resumed = mic.resumed
  mic.resumed = false
  const take = await capture(mic, onInterrupted)
  if (resumed && isDigitalSilence(take.first) && currentMicrophone() === mic) {
    take.cancel()
    releaseMicrophone()
    return capture(await openMicrophone(), onInterrupted)
  }
  return take
}

function openAfreshNextTap(mic: Microphone): void {
  if (currentMicrophone() === mic) releaseMicrophone()
  stopPlayback()
  replaceAudioContext(mic.context)
}

function isDigitalSilence(samples: Float32Array): boolean {
  return samples.every(sample => sample === 0)
}

function joined(chunks: Float32Array[]): Float32Array {
  const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    samples.set(chunk, at)
    at += chunk.length
  }
  return samples
}

async function capture(
  mic: Microphone,
  onInterrupted: () => void
): Promise<Take & { first: Float32Array }> {
  const id = nextTakeId()
  let begin = () => {}
  let fail = (_: Error) => {}
  const started = new Promise<void>((resolve, reject) => {
    begin = resolve
    fail = reject
  })
  let inProgress = false
  const take: Capturing = {
    id,
    chunks: [],
    listener: null,
    began: () => begin(),
    finished: null,
    lost: () => {
      if (inProgress) onInterrupted()
      else fail(new MicrophoneReleasedError())
    }
  }
  startCapturing(take)
  sendCommand(mic.node, { type: 'start', take: id })

  const clockAt = mic.context.currentTime
  const timeout = setTimeout(
    () => fail(new NoMicrophoneAudioError(mic.context, clockAt)),
    firstBatchTimeoutMs
  )
  try {
    await started
  } catch (error) {
    if (stopCapturing(take)) sendCommand(mic.node, { type: 'cancel', take: id })
    if (error instanceof NoMicrophoneAudioError) openAfreshNextTap(mic)
    throw error
  } finally {
    clearTimeout(timeout)
  }
  inProgress = true

  return {
    first: take.chunks[0],
    sampleRate: mic.context.sampleRate,
    listen(listener) {
      for (const chunk of take.chunks) listener(chunk)
      take.listener = listener
    },
    async stop() {
      if (takeInProgress() === take) {
        await new Promise<void>(resolve => {
          take.finished = resolve
          sendCommand(mic.node, { type: 'stop', take: id })
          setTimeout(resolve, lastBatchTimeoutMs)
        })
        stopCapturing(take)
      }
      return { samples: joined(take.chunks), sampleRate: mic.context.sampleRate }
    },
    cancel() {
      if (stopCapturing(take)) sendCommand(mic.node, { type: 'cancel', take: id })
    }
  }
}
