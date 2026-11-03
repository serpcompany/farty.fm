import {
  type CaptureBatch,
  type CaptureCommand,
  captureProcessorSource
} from '@/lib/audio/capture-processor'

export type CaptureProcessor = {
  port: { onmessage: ((event: { data: CaptureCommand }) => void) | null }
  process(inputs: Float32Array[][]): boolean
}

export const renderQuantum = 128
export const captureSampleRate = 48_000

export function newCaptureProcessor(reply: (batch: CaptureBatch) => void): CaptureProcessor {
  class AudioWorkletProcessor {
    port = { onmessage: null, postMessage: reply }
  }
  let Registered: (new () => CaptureProcessor) | undefined
  const register = (_name: string, processor: new () => CaptureProcessor) => {
    Registered = processor
  }
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', captureProcessorSource)(
    AudioWorkletProcessor,
    register,
    captureSampleRate
  )
  if (!Registered) throw new Error('The source registered no processor')
  return new Registered()
}
