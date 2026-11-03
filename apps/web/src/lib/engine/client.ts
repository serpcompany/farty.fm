import { workerRequests } from '@/lib/analysis/worker-requests'
import type { Performance } from '@/lib/performance'
import type { Arrangement } from './auto-map'
import type { PerformanceRecording, RenderedPerformance } from './render-performance'
import type { RecordingToRender, RenderedSong } from './render-song'
import type { Song } from './song'
import type { Rendered, RenderRequest } from './worker'

const requestRender = workerRequests<RenderRequest, Rendered>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  'Rendering failed'
)

export function renderInWorker(
  song: Song,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[]
): Promise<RenderedSong> {
  const rendering = requestRender({ song, arrangement, recordings: [...recordings] })
  return rendering as Promise<RenderedSong>
}

export function renderPerformanceInWorker(
  performance: Performance,
  recordings: readonly PerformanceRecording[]
): Promise<RenderedPerformance> {
  const rendering = requestRender({ performance, recordings: [...recordings] })
  return rendering as Promise<RenderedPerformance>
}

export function padSoundInWorker(
  channels: readonly Float32Array[],
  sampleRate: number
): Promise<Float32Array<ArrayBuffer>[]> {
  const cutting = requestRender({ pad: { channels: [...channels], sampleRate } })
  return cutting as Promise<Float32Array<ArrayBuffer>[]>
}
