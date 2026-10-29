import { workerRequests } from '@/lib/analysis/worker-requests'
import type { Arrangement } from './auto-map'
import type { RecordingToRender, RenderedSong } from './render-song'
import type { Song } from './song'
import type { RenderRequest } from './worker'

const requestRender = workerRequests<RenderRequest, RenderedSong>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  'Rendering failed'
)

export function renderInWorker(
  song: Song,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[]
): Promise<RenderedSong> {
  return requestRender({ song, arrangement, recordings: [...recordings] })
}
