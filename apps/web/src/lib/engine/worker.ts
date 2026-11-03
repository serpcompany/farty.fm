import { answerRequests } from '@/lib/analysis/worker-requests'
import { padSound } from '@/lib/pads'
import type { Performance } from '@/lib/performance'
import type { Arrangement } from './auto-map'
import {
  type PerformanceRecording,
  type RenderedPerformance,
  renderPerformance
} from './render-performance'
import { type RecordingToRender, type RenderedSong, renderFromRecordings } from './render-song'
import type { Song } from './song'

export interface SongRenderRequest {
  id: number
  song: Song
  arrangement: Arrangement
  recordings: RecordingToRender[]
}

export interface PerformanceRenderRequest {
  id: number
  performance: Performance
  recordings: PerformanceRecording[]
}

export interface PadSoundRequest {
  id: number
  pad: { channels: Float32Array[]; sampleRate: number }
}

export type RenderRequest = SongRenderRequest | PerformanceRenderRequest | PadSoundRequest

export type Rendered = RenderedSong | RenderedPerformance | Float32Array<ArrayBuffer>[]

answerRequests<RenderRequest, Rendered>(
  request => {
    if ('pad' in request) return padSound(request.pad.channels, request.pad.sampleRate)
    return 'performance' in request
      ? renderPerformance(request.performance, request.recordings)
      : renderFromRecordings(request.song, request.arrangement, request.recordings)
  },
  rendered =>
    Array.isArray(rendered) ? rendered.map(channel => channel.buffer) : [rendered.samples.buffer]
)
