import { audioContext, setPlaybackSession } from './context'

/**
 * Each sound's decode, by key, so replaying doesn't decode again and taps during a decode share it.
 * Forgetting a key mid-decode drops that decode: when it finishes, nothing keeps its buffer.
 */
const decoded = new Map<string, Promise<AudioBuffer>>()

let current: AudioBufferSourceNode | null = null

/**
 * Counts every play and stop. A sound still loading when another starts, or when playback stops,
 * sees the count change and never starts.
 */
let requests = 0

/** Counts every play. Only the latest play reports its end. */
let plays = 0

export type Segment = { start: number; end: number }

/**
 * Plays `wav` (or just `segment` of it, in seconds), like the iPhone app's single player.
 * `onEnded` runs when the sound finishes, when `stopPlayback` stops it or its load, or when it
 * can't load. Starting another sound stops this one without calling its `onEnded`: the later play
 * now owns the player, even when it plays the same Recording.
 */
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
      // A failed decode is tried again on the next play.
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
  // onended still fires, which tells the caller playback stopped.
  source.stop()
}

export function forgetDecoded(key: string): void {
  decoded.delete(key)
}
