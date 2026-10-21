/// <reference lib="webworker" />
import { analyzeToAnalysis } from './port'

/** Runs Recording Analysis off the page's thread. One request at a time, answered by id. */
self.onmessage = (
  event: MessageEvent<{ id: number; samples: Float32Array; sampleRate: number }>
) => {
  const { id, samples, sampleRate } = event.data
  try {
    self.postMessage({ id, analysis: analyzeToAnalysis(samples, sampleRate) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
