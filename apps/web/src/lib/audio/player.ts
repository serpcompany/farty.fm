import { audioContext, isClosed, setPlaybackSession, whenClosing } from './context'

/**
 * Each sound's decode, by key, so replaying doesn't decode again and taps during a decode share it.
 * Forgetting a key mid-decode drops that decode: when it finishes, nothing keeps its buffer.
 */
const decoded = new Map<string, Promise<AudioBuffer>>()

/**
 * The sound playing, what tells its play it ended, and where it plays: from `offset` to `end`
 * seconds of its audio, started at `startedAt` on its context's clock.
 */
let current: {
  source: AudioBufferSourceNode
  ended: () => void
  context: BaseAudioContext
  startedAt: number
  offset: number
  end: number
} | null = null

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
 * `onEnded` runs once: when the sound finishes, when `stopPlayback` stops it or its load, when its
 * context closes (`whenClosing`), or when it can't load. Starting another sound stops this one
 * without calling its `onEnded`: the later play now owns the player, even when it plays the same
 * Recording.
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
    // A context closed or closing since the load began, as one replaced after a hide
    // (`audioContext`), plays nothing: a sound started on it would never end.
    if (request !== requests || isClosed(context)) {
      ended()
      return
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const offset = segment ? Math.max(0, Math.min(segment.start, buffer.duration)) : 0
    const end = segment ? Math.max(offset, Math.min(segment.end, buffer.duration)) : buffer.duration
    const startedAt = context.currentTime
    const playing = {
      source,
      context,
      startedAt,
      offset,
      end,
      ended: () => {
        if (current === playing) current = null
        ended()
      }
    }
    source.onended = playing.ended
    current = playing
    // Started at once (0), which is `startedAt` on the context's clock.
    if (segment) source.start(0, offset, end - offset)
    else source.start()
  } catch {
    ended()
  }
}

/**
 * Where the sound playing is, in seconds of its audio, by its context's clock: what a playhead
 * follows, so it stays with the sound. Null while nothing plays, or a sound still loads.
 */
export function playbackPosition(): number | null {
  if (!current) return null
  const { context, startedAt, offset, end } = current
  return Math.min(end, offset + Math.max(0, context.currentTime - startedAt))
}

export function stopPlayback(): void {
  requests += 1
  endCurrent()
}

// Closing a context never fires `onended` on what plays on it, so the sound is stopped and its end
// reported here first.
whenClosing(context => {
  if (current?.source.context === context) endCurrent()
})

/**
 * Stops the sound playing and reports its end here, not from `onended`: a stop on a suspended
 * context, as on iPhone when the page hides, waits for a clock that stands still, and if the
 * context then closes, `onended` never fires.
 */
function endCurrent(): void {
  if (!current) return
  const { source, ended } = current
  current = null
  source.onended = null
  try {
    source.stop()
  } catch {
    // It had already stopped.
  }
  ended()
}

export function forgetDecoded(key: string): void {
  decoded.delete(key)
}
