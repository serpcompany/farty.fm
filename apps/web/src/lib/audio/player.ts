import { audioContext, setAudioSession } from './context'

/** Decoded audio by Recording id, so replaying doesn't decode again. */
const decoded = new Map<string, AudioBuffer>()

let current: { source: AudioBufferSourceNode; onEnded: () => void } | null = null

export type Segment = { start: number; end: number }

/**
 * Plays `wav` (or just `segment` of it, in seconds) and calls `onEnded` when it finishes or is
 * stopped. Starting another sound stops this one, like the iPhone app's single player.
 */
export async function play(
  key: string,
  wav: () => Promise<ArrayBuffer>,
  segment: Segment | null,
  onEnded: () => void
): Promise<void> {
  stopPlayback()
  const context = audioContext()
  setAudioSession('playback')
  await context.resume()
  let buffer = decoded.get(key)
  if (!buffer) {
    buffer = await context.decodeAudioData(await wav())
    decoded.set(key, buffer)
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  const entry = { source, onEnded }
  source.onended = () => {
    if (current === entry) current = null
    onEnded()
  }
  current = entry
  if (segment) {
    const start = Math.max(0, Math.min(segment.start, buffer.duration))
    source.start(0, start, Math.max(0, Math.min(segment.end, buffer.duration) - start))
  } else {
    source.start()
  }
}

export function stopPlayback(): void {
  if (!current) return
  const { source } = current
  current = null
  // onended still fires, which tells the caller playback stopped.
  source.stop()
}

export function forgetDecoded(key: string): void {
  decoded.delete(key)
}
