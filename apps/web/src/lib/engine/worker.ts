/// <reference lib="webworker" />
import type { Performance } from '@/lib/performance'
import type { Arrangement } from './auto-map'
import { type PerformanceRecording, renderPerformance } from './render-performance'
import { type RecordingToRender, renderFromRecordings } from './render-song'
import type { Song } from './song'

/** A Song to render with its Arrangement, on the Recordings it uses. */
export interface SongRenderRequest {
  id: number
  song: Song
  arrangement: Arrangement
  recordings: RecordingToRender[]
}

/** A Sound Pad Performance to render, on the Recordings it plays (#278). */
export interface PerformanceRenderRequest {
  id: number
  performance: Performance
  recordings: PerformanceRecording[]
}

export type RenderRequest = SongRenderRequest | PerformanceRenderRequest

/** Renders Songs and Performances off the page's thread. One request at a time, answered by id. */
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  try {
    const rendered =
      'performance' in request
        ? renderPerformance(request.performance, request.recordings)
        : renderFromRecordings(request.song, request.arrangement, request.recordings)
    // The audio moves to the page instead of being copied.
    self.postMessage({ id: request.id, rendered }, [rendered.samples.buffer])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id: request.id, error: message })
  }
}
