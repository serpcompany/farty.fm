import { audioContext, isClosed, setPlaybackSession, whenClosing } from './context'

const decoded = new Map<string, Promise<AudioBuffer>>()

let current: {
  source: AudioBufferSourceNode
  ended: () => void
  context: BaseAudioContext
  startedAt: number
  offset: number
  end: number
} | null = null

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
    if (segment) source.start(0, offset, end - offset)
    else source.start()
  } catch {
    ended()
  }
}

export function playbackPosition(): number | null {
  if (!current) return null
  const { context, startedAt, offset, end } = current
  const reported = 'outputLatency' in context ? Number(context.outputLatency) : 0
  const latency = Number.isFinite(reported) && reported > 0 ? reported : 0
  return Math.min(end, offset + Math.max(0, context.currentTime - startedAt - latency))
}

export function stopPlayback(): void {
  requests += 1
  endCurrent()
}

whenClosing(context => {
  if (current?.source.context === context) endCurrent()
})

function endCurrent(): void {
  if (!current) return
  const { source, ended } = current
  current = null
  source.onended = null
  try {
    source.stop()
  } catch {}
  ended()
}

export function forgetDecoded(key: string): void {
  decoded.delete(key)
}
