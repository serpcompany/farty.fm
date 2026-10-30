import type { Analysis, Trim } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'

/**
 * Runs Recording Analysis in a Web Worker, so pYIN never freezes the page. One worker serves
 * every request, in order.
 */
let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve(reply: Reply): void; reject(e: Error): void }>()

type Reply = { id: number; analysis?: Analysis; trim?: Trim; error?: string }

function analysisWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const reply = event.data
    const request = pending.get(reply.id)
    pending.delete(reply.id)
    if (!request) return
    if (reply.error === undefined) request.resolve(reply)
    else request.reject(new Error(reply.error))
  }
  worker.onerror = event => {
    for (const request of pending.values()) request.reject(new Error(event.message))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function ask(audio: PcmAudio, trim?: Trim): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    // A copy goes to the worker; the caller keeps its samples.
    analysisWorker().postMessage({
      id,
      samples: audio.samples.slice(),
      sampleRate: audio.sampleRate,
      trim
    })
  })
}

export async function analyze(audio: PcmAudio): Promise<Analysis> {
  const { analysis } = await ask(audio)
  if (!analysis) throw new Error('Analysis failed')
  return analysis
}

/** The Trim the picker's handles keep in `audio` (`trimBounds`, ADR 0019). */
export async function findTrim(audio: PcmAudio, handles: Trim): Promise<Trim> {
  const { trim } = await ask(audio, handles)
  if (!trim) throw new Error('Trim failed')
  return trim
}
