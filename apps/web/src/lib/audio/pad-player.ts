import { padSoundInWorker } from '../engine/client'
import { AudioNotDownloaded } from '../recording-store'
import { audioContext, setPlaybackSession } from './context'

const sounds = new Map<string, Promise<AudioBuffer>>()

const voices = new Set<AudioBufferSourceNode>()

export class PadAudioUnavailable extends Error {
  constructor(cause: unknown) {
    super('The Recording’s audio isn’t in this browser yet', { cause })
    this.name = 'PadAudioUnavailable'
  }
}

export function loadPadSound(id: string, wav: () => Promise<ArrayBuffer>): Promise<AudioBuffer> {
  let loading = sounds.get(id)
  if (!loading) {
    const audio = wav().catch(error => {
      throw error instanceof AudioNotDownloaded ? new PadAudioUnavailable(error) : error
    })
    const started = audio.then(async data => {
      const context = audioContext()
      const decoded = await context.decodeAudioData(data)
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
        decoded.getChannelData(c)
      )
      const trimmed = await padSoundInWorker(channels, decoded.sampleRate)
      const sound = new AudioBuffer({
        length: Math.max(1, trimmed[0].length),
        numberOfChannels: trimmed.length,
        sampleRate: decoded.sampleRate
      })
      trimmed.forEach((channel, c) => {
        sound.copyToChannel(channel, c)
      })
      return sound
    })
    sounds.set(id, started)
    started.catch(() => {
      if (sounds.get(id) === started) sounds.delete(id)
    })
    loading = started
  }
  return loading
}

export function keepPadSounds(kept: ReadonlySet<string>): void {
  for (const id of sounds.keys()) if (!kept.has(id)) sounds.delete(id)
}

export function playPadSound(sound: AudioBuffer, onEnded: () => void): void {
  const context = audioContext()
  setPlaybackSession()
  if (context.state !== 'running') context.resume().catch(() => {})
  const source = new AudioBufferSourceNode(context, { buffer: sound })
  source.connect(context.destination)
  source.onended = () => {
    voices.delete(source)
    source.disconnect()
    onEnded()
  }
  voices.add(source)
  source.start()
}

export function stopPadSounds(): void {
  for (const source of [...voices]) {
    try {
      source.stop()
    } catch {
      source.onended?.call(source, new Event('ended'))
    }
  }
}
