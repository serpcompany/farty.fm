import type { Performance } from '@/lib/performance'
import type { Arrangement } from './auto-map'
import type { PerformanceRecording, RenderedPerformance } from './render-performance'
import type { RecordingToRender, RenderedSong } from './render-song'
import type { Song } from './song'
import type { RenderRequest } from './worker'

/**
 * Renders Songs and Performances in a Web Worker, so resampling never freezes the page. One worker
 * serves every request, in order. Web Audio only plays the result.
 */
let worker: Worker | null = null
let nextId = 0
type Rendered = RenderedSong | RenderedPerformance
const pending = new Map<number, { resolve(r: Rendered): void; reject(e: Error): void }>()

type Reply = { id: number; rendered?: Rendered; error?: string }

function renderWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const { id, rendered, error } = event.data
    const request = pending.get(id)
    pending.delete(id)
    if (!request) return
    if (rendered) request.resolve(rendered)
    else request.reject(new Error(error ?? 'Rendering failed'))
  }
  worker.onerror = event => {
    for (const request of pending.values()) request.reject(new Error(event.message))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Posts the request that `request` builds for its id, and waits for the answer. */
function ask(request: (id: number) => RenderRequest): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    renderWorker().postMessage(request(id))
  })
}

/**
 * Plays `song` with `arrangement` (from `arrange`) on the Recordings it names, off the page's
 * thread. Each Recording's audio is copied to the worker; the caller keeps its own.
 */
export function renderInWorker(
  song: Song,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[]
): Promise<RenderedSong> {
  const rendering = ask(id => ({ id, song, arrangement, recordings: [...recordings] }))
  return rendering as Promise<RenderedSong>
}

/**
 * Plays a Sound Pad `performance` on the Recordings it names (`renderPerformance`), off the page's
 * thread. As with `renderInWorker`, the caller keeps its own audio.
 */
export function renderPerformanceInWorker(
  performance: Performance,
  recordings: readonly PerformanceRecording[]
): Promise<RenderedPerformance> {
  const rendering = ask(id => ({ id, performance, recordings: [...recordings] }))
  return rendering as Promise<RenderedPerformance>
}
