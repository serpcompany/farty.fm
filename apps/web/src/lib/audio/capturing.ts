import type { CaptureBatch } from './capture-processor'

export type Capturing = {
  id: number
  chunks: Float32Array[]
  began(): void
  finished: (() => void) | null
  lost(): void
}

let capturing: Capturing | null = null
let takes = 0

export function nextTakeId(): number {
  takes += 1
  return takes
}

export function takeInProgress(): Capturing | null {
  return capturing
}

export function startCapturing(take: Capturing): void {
  capturing = take
}

export function stopCapturing(take: Capturing): boolean {
  if (capturing !== take) return false
  capturing = null
  return true
}

export function receiveBatch(batch: CaptureBatch): void {
  const take = capturing
  if (!take || batch.take !== take.id) return
  take.chunks.push(batch.samples)
  take.began()
  if (batch.done) take.finished?.()
}
