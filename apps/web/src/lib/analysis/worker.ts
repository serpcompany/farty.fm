/// <reference lib="webworker" />
import { analyzeToAnalysis } from './port'
import { resampleToAnalysisRate } from './resample'
import { trimBounds } from './trimming'

/** One request: Recording Analysis of a take, or the Trim its handles keep (`trim`). */
type AnalysisRequest = {
  id: number
  samples: Float32Array
  sampleRate: number
  trim?: { startSeconds: number; endSeconds: number }
}

/**
 * Runs Recording Analysis off the page's thread, and finds a Trim (ADR 0019), which resamples the
 * whole take to 44.1 kHz first. One request at a time, answered by id.
 */
self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, samples, sampleRate, trim } = event.data
  try {
    if (trim) {
      const y = resampleToAnalysisRate(samples, sampleRate)
      self.postMessage({ id, trim: trimBounds(y, trim.startSeconds, trim.endSeconds) })
    } else {
      self.postMessage({ id, analysis: analyzeToAnalysis(samples, sampleRate) })
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
