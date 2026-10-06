import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'

/**
 * Runs Recording Analysis in a Web Worker, so pYIN never freezes the page. One worker serves
 * every request, in order.
 */
let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve(a: Analysis): void; reject(e: Error): void }>()

type Reply = { id: number; analysis?: Analysis; error?: string }

function analysisWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const { id, analysis, error } = event.data
    const request = pending.get(id)
    pending.delete(id)
    if (!request) return
    if (analysis) request.resolve(analysis)
    else request.reject(new Error(error ?? 'Analysis failed'))
  }
  worker.onerror = event => {
    for (const request of pending.values()) request.reject(new Error(event.message))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function analyze(audio: PcmAudio): Promise<Analysis> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    // A copy goes to the worker; the caller keeps its samples.
    analysisWorker().postMessage({
      id,
      samples: audio.samples.slice(),
      sampleRate: audio.sampleRate
    })
  })
}
