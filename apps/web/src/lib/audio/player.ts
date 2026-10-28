import { audioContext, setPlaybackSession } from './context'

const decoded = new Map<string, Promise<AudioBuffer>>()

let current: AudioBufferSourceNode | null = null

let requests = 0

let plays = 0

export type Segment = { start: number; end: number }

export async function play(
  key: string,
  wav: () => Promise<ArrayBuffer>,
  segment: Segment | null,
  onEnded: () => void
): Promise<void> {
  plays += 1
  const thisPlay = plays
  const ended = () => {
    if (thisPlay === plays) onEnded()
  }
  stopPlayback()
  const request = requests
  try {
    const context = audioContext()
    setPlaybackSession()
    await context.resume()
    let decoding = decoded.get(key)
    if (!decoding) {
      const started = wav().then(data => context.decodeAudioData(data))
      decoded.set(key, started)
      started.catch(() => {
        if (decoded.get(key) === started) decoded.delete(key)
      })
      decoding = started
    }
    const buffer = await decoding
    if (request !== requests) {
      ended()
      return
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      if (current === source) current = null
      ended()
    }
    current = source
    if (segment) {
      const start = Math.max(0, Math.min(segment.start, buffer.duration))
      source.start(0, start, Math.max(0, Math.min(segment.end, buffer.duration) - start))
    } else {
      source.start()
    }
  } catch {
    ended()
  }
}

export function stopPlayback(): void {
  requests += 1
  if (!current) return
  const source = current
  current = null
  source.stop()
}

export function forgetDecoded(key: string): void {
  decoded.delete(key)
}
