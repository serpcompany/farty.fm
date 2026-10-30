import { type Recording, songPitch } from './recordings'

// The Sound Pad (#277): a grid of Pads, each playing one of the user's Recordings when tapped,
// raw, as recorded (ADR 0012). What each Pad plays, and how much of its Recording.

/** How many Pads the Sound Pad has: three across and four down, sized for a phone. */
export const PAD_COUNT = 12

/** The Recording each Pad plays, by Pad (0 is the top left), or null for an empty Pad. */
export type PadMapping = readonly (string | null)[]

/** The Recordings the user put on Pads, by Pad, as `pad-store.ts` keeps them. */
export type AssignedPads = ReadonlyMap<number, string>

/**
 * The order empty Pads fill in: the Recordings Songs use on a note (Melodic, or Placed at their
 * Placed Pitch) from the lowest note up, then the rest (Noise-like, or not analyzed yet), oldest
 * first.
 */
export function fillOrder(recordings: readonly Recording[]): Recording[] {
  const noted = recordings
    .map(recording => ({ recording, pitch: songPitch(recording) }))
    .filter((r): r is { recording: Recording; pitch: number } => r.pitch !== null)
    .sort((a, b) => a.pitch - b.pitch || a.recording.number - b.recording.number)
    .map(r => r.recording)
  const rest = recordings
    .filter(recording => songPitch(recording) === null)
    .sort((a, b) => a.number - b.number)
  return [...noted, ...rest]
}

/**
 * What each Pad plays. A Pad the user assigned keeps its Recording while it exists. Every other
 * Pad fills, in turn, with the next Recording on no Pad, in `fillOrder`. So the Pads start filled,
 * and a new Recording lands on the first empty Pad.
 */
export function padMapping(recordings: readonly Recording[], assigned: AssignedPads): PadMapping {
  const ids = new Set(recordings.map(recording => recording.id))
  const pads = Array.from({ length: PAD_COUNT }, (_, pad) => {
    const id = assigned.get(pad)
    return id !== undefined && ids.has(id) ? id : null
  })
  const onPads = new Set(pads)
  const free = fillOrder(recordings).filter(recording => !onPads.has(recording.id))
  return pads.map(id => id ?? free.shift()?.id ?? null)
}

/**
 * The Pads to keep once the user puts Recording `id` on `pad`: every Pad as it shows now, with
 * `pad` changed. Keeping them all means only the Pad the user touched changes, now and as
 * Recordings come and go. A Recording may be on more than one Pad.
 */
export function assignPad(shown: PadMapping, pad: number, id: string): Map<number, string> {
  const kept = new Map<number, string>()
  shown.forEach((shownId, index) => {
    const next = index === pad ? id : shownId
    if (next !== null) kept.set(index, next)
  })
  return kept
}

/** The trim reads the take in windows this long. */
const WINDOW_SECONDS = 0.01
/**
 * A window sounds when its level is within this many dB of the loudest window's: Recording
 * Analysis' rule for where a fart ends (`noteSegment`), used at both ends.
 */
const BELOW_PEAK_DB = 30
/** Kept before the first window that sounds, so a fart's soft start isn't lost. */
const LEAD_SECONDS = 0.01
/** Kept after the last window that sounds, for its tail. */
const TAIL_SECONDS = 0.05
/** The fades, as Songs' renderer has them: 3 ms in, and up to 30 ms out (linear here). */
const FADE_IN_SECONDS = 0.003
const FADE_OUT_SECONDS = 0.03

/** A stretch of a take, in samples: `end` is exclusive. */
export type Span = { start: number; end: number }

/**
 * Where a take sounds: from just before its first 10 ms window within 30 dB of its loudest, to
 * just after its last. Only the silence before and after goes: a second fart in the take stays
 * (owner, 2026-10-30, #275). A take with no sound at all is kept whole.
 */
export function soundingSpan(samples: Float32Array, sampleRate: number): Span {
  const window = Math.max(1, Math.round(WINDOW_SECONDS * sampleRate))
  const count = Math.ceil(samples.length / window)
  const power = new Float64Array(count)
  for (let w = 0; w < count; w++) {
    const from = w * window
    const to = Math.min(samples.length, from + window)
    let sum = 0
    for (let i = from; i < to; i++) sum += samples[i] * samples[i]
    power[w] = sum / (to - from)
  }
  const peak = power.reduce((loudest, p) => Math.max(loudest, p), 0)
  if (!(peak > 0)) return { start: 0, end: samples.length }
  const floor = peak * 10 ** (-BELOW_PEAK_DB / 10)
  const first = power.findIndex(p => p >= floor)
  const last = power.findLastIndex(p => p >= floor)
  return {
    start: Math.max(0, first * window - Math.round(LEAD_SECONDS * sampleRate)),
    end: Math.min(samples.length, (last + 1) * window + Math.round(TAIL_SECONDS * sampleRate))
  }
}

/**
 * What a Pad plays of a take, each channel: its sounding span (`soundingSpan`, read on the
 * channels' mix), faded in over 3 ms and out over 30 ms. Nothing else changes: the fart keeps its
 * own pitch, speed and level (ADR 0004, ADR 0012).
 */
export function padSound(
  channels: readonly Float32Array[],
  sampleRate: number
): Float32Array<ArrayBuffer>[] {
  const length = channels[0]?.length ?? 0
  const mix = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mix[i] += channel[i] / channels.length
  }
  const { start, end } = soundingSpan(mix, sampleRate)
  const n = end - start
  const fadeIn = Math.min(n, Math.round(FADE_IN_SECONDS * sampleRate))
  const fadeOut = Math.min(n, Math.round(FADE_OUT_SECONDS * sampleRate))
  return channels.map(channel => {
    const out = channel.slice(start, end)
    for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
    for (let i = 0; i < fadeOut; i++) out[n - 1 - i] *= i / fadeOut
    return out
  })
}
