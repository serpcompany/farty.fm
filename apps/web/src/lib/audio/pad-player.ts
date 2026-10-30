import { padSound } from '../pads'
import { AudioNotDownloaded } from '../recording-store'
import { audioContext, setPlaybackSession } from './context'

// The Sound Pad's player (#277). Unlike the app's single player (`player.ts`), every tap plays a
// sound of its own, so taps overlap and mix. Each Pad's sound is decoded, trimmed and set to the Pads' level ahead, so a
// tap only starts a buffer: no decode, no await.

/** Each Recording's Pad sound, by Recording id: decoded and trimmed once (`padSound`). */
const sounds = new Map<string, Promise<AudioBuffer>>()

/** The sounds playing now, every Pad's. */
const voices = new Set<AudioBufferSourceNode>()

/**
 * Recording's audio this browser can't get yet, such as offline before it downloaded: expected,
 * so not reported, and tried again later.
 */
export class PadAudioUnavailable extends Error {
  constructor(cause: unknown) {
    super('The Recording’s audio isn’t in this browser yet', { cause })
    this.name = 'PadAudioUnavailable'
  }
}

/**
 * Decodes Recording `id`'s audio on the shared AudioContext and trims it as a Pad plays it, once:
 * a later call gets the same sound. A failed one is tried again on the next call. It fails with
 * `PadAudioUnavailable` only when `wav`'s download couldn't be fetched now (`AudioNotDownloaded`),
 * and otherwise with the error itself: a database that can't be read, a Recording with no audio
 * here or in the account, or a decode.
 */
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
      const trimmed = padSound(channels, decoded.sampleRate)
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

/** Lets go of every Pad sound but those of `kept` Recordings. */
export function keepPadSounds(kept: ReadonlySet<string>): void {
  for (const id of sounds.keys()) if (!kept.has(id)) sounds.delete(id)
}

/**
 * Plays `sound` now, over whatever plays already, at its own pitch and speed, and at the Pads' one
 * level (`padSound` set its gain, so two at once can't clip). `onEnded` runs once it finishes or
 * `stopPadSounds` stops it. Call it in the tap itself: if the AudioContext isn't running yet, the
 * sound starts as soon as it is. On iOS that's on the tap's release when the context isn't running
 * yet: opening `/compose/pad/` directly, after the page was hidden, or after
 * `replaceAudioContext`, since WebKit doesn't count a touch's press as a tap that may start audio.
 */
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

/** Stops every Pad's sound: leaving the Sound Pad, or the page hidden. */
export function stopPadSounds(): void {
  for (const source of [...voices]) {
    try {
      source.stop()
    } catch {
      // Its AudioContext closed (`replaceAudioContext`), which silenced it, and it never ends.
      source.onended?.call(source, new Event('ended'))
    }
  }
}
