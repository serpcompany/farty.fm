/// <reference lib="webworker" />
import { padSound } from '@/lib/pads'
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

/** A take's channels to cut as a Pad plays them (`padSound`, #298), at their own rate. */
export interface PadSoundRequest {
  id: number
  pad: { channels: Float32Array[]; sampleRate: number }
}

export type RenderRequest = SongRenderRequest | PerformanceRenderRequest | PadSoundRequest

/**
 * Renders Songs and Performances, and cuts Pads' sounds, off the page's thread. One request at a
 * time, answered by id.
 */
self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  try {
    if ('pad' in request) {
      const channels = padSound(request.pad.channels, request.pad.sampleRate)
      self.postMessage(
        { id: request.id, rendered: channels },
        channels.map(channel => channel.buffer)
      )
      return
    }
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
