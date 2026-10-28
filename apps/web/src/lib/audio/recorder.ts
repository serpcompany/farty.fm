import type { PcmAudio } from '@/lib/wav'
import { sendCommand } from './capture-processor'
import {
  type Capturing,
  nextTakeId,
  startCapturing,
  stopCapturing,
  takeInProgress
} from './capturing'
import { audioContext } from './context'
import {
  currentMicrophone,
  interrupted,
  type Microphone,
  MicrophoneReleasedError,
  openMicrophone,
  releaseMicrophone
} from './microphone'

export type Take = {
  stop(): Promise<PcmAudio>
  cancel(): void
}

const firstBatchTimeoutMs = 3000
const lastBatchTimeoutMs = 500

export async function startTake(onInterrupted: () => void): Promise<Take> {
  audioContext()
    .resume()
    .catch(() => {})
  const open = currentMicrophone()
  if (open && !takeInProgress() && interrupted(open)) releaseMicrophone()
  let mic = await openMicrophone()
  if (interrupted(mic) && !takeInProgress()) {
    releaseMicrophone()
    mic = await openMicrophone()
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
    began: () => begin(),
    finished: null,
    lost: () => {
      if (inProgress) onInterrupted()
      else fail(new MicrophoneReleasedError())
    }
  }
  startCapturing(take)
  sendCommand(mic.node, { type: 'start', take: id })

  const timeout = setTimeout(
    () => fail(new Error('No audio from the microphone')),
    firstBatchTimeoutMs
  )
  try {
    await started
  } catch (error) {
    if (stopCapturing(take)) sendCommand(mic.node, { type: 'cancel', take: id })
    throw error
  } finally {
    clearTimeout(timeout)
  }
  inProgress = true

  return {
    first: take.chunks[0],
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
