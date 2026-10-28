import type { Arrangement } from './auto-map'
import type { RecordingToRender, RenderedSong } from './render-song'
import type { Song } from './song'
import type { RenderRequest } from './worker'

/**
 * Renders Songs in a Web Worker, so resampling never freezes the page. One worker serves every
 * request, in order. Web Audio only plays the result.
 */
let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve(r: RenderedSong): void; reject(e: Error): void }>()

type Reply = { id: number; rendered?: RenderedSong; error?: string }

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

/**
 * Plays `song` with `arrangement` (from `arrange`) on the Recordings it names, and its Beats on
 * `beats` (from `beatRecordings`), off the page's thread. Each Recording's audio is copied to the
 * worker; the caller keeps its own.
 */
export function renderInWorker(
  song: Song,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[],
  beats: readonly string[] = []
): Promise<RenderedSong> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const request: RenderRequest = {
      id,
      song,
      arrangement,
      recordings: [...recordings],
      beats: [...beats]
    }
    renderWorker().postMessage(request)
  })
}
