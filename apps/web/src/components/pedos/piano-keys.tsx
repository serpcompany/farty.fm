'use client'

import { audioContext, setPlaybackSession } from '@/lib/audio/context'
import { noteName, pitchClassNames } from '@/lib/pitch'
import { cn } from '@/lib/utils'

// One octave of piano keys for giving a Recording its note by ear on its review (ADR 0015, #314),
// and the piano note each key plays. The note goes straight to the speakers, to compare the fart
// with or to hear a Song's melody (#359): renders, Toots and shares never play it, and stay
// fart-only (AGENTS.md, `piano-boundary.test.ts`).

/** The white keys, as steps up from C. */
const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]

/** The black keys, as steps up from C, each centered on the line after its `after`th white key. */
const BLACK_KEYS = [
  { step: 1, after: 1 },
  { step: 3, after: 2 },
  { step: 6, after: 4 },
  { step: 8, after: 5 },
  { step: 10, after: 6 }
]

/** A black key's width, as a share of the keyboard's. */
const BLACK_WIDTH = 60 / WHITE_STEPS.length

/** The octave a MIDI note is in, where C4 is 60. */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1
}

/**
 * The twelve keys from C to B of `octave`. A white key names its note on C, and on the key picked;
 * the others name only the letter. The key picked is filled; the note analysis found, if it isn't
 * the one picked, is ringed.
 */
export function PianoKeys({
  octave,
  selected,
  ringed,
  onKey
}: {
  octave: number
  /** The key picked, as a MIDI note, or null. */
  selected: number | null
  /** The note analysis found, ringed when it isn't the one picked, or null. */
  ringed: number | null
  onKey: (midi: number) => void
}) {
  const c = 12 * (octave + 1)
  const state = (midi: number) => ({
    isSelected: midi === selected,
    isRinged: midi === ringed && midi !== selected
  })
  return (
    // The fieldset only names the keys: Chrome lays a fieldset's children out in a box of its own,
    // which doesn't take the fieldset's height, so the keys' layout is the div inside.
    <fieldset className="min-w-0">
      <legend className="sr-only">Piano</legend>
      <div className="relative flex h-42 touch-manipulation">
        {WHITE_STEPS.map(step => {
          const midi = c + step
          const { isSelected, isRinged } = state(midi)
          return (
            <button
              key={midi}
              type="button"
              aria-label={noteName(midi)}
              aria-pressed={isSelected}
              onClick={() => onKey(midi)}
              className={cn(
                'flex min-w-0 flex-1 items-end justify-center rounded-b-[7px] border border-t-0 border-neutral-300 bg-white pb-2 text-[11px] text-neutral-500 outline-none not-first:-ml-px focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-200 dark:active:bg-neutral-300',
                step === 0 && 'font-semibold text-neutral-950',
                isRinged && 'inset-ring-2 inset-ring-brand-strong',
                isSelected &&
                  'border-brand-strong bg-brand-strong font-semibold text-white active:bg-brand-strong dark:border-brand-strong dark:bg-brand-strong dark:active:bg-brand-strong'
              )}
            >
              {isSelected || step === 0 ? noteName(midi) : pitchClassNames[step]}
            </button>
          )
        })}
        {BLACK_KEYS.map(({ step, after }) => {
          const midi = c + step
          const { isSelected, isRinged } = state(midi)
          const center = (after / WHITE_STEPS.length) * 100
          return (
            <button
              key={midi}
              type="button"
              aria-label={noteName(midi)}
              aria-pressed={isSelected}
              onClick={() => onKey(midi)}
              style={{ left: `${center - BLACK_WIDTH / 2}%`, width: `${BLACK_WIDTH}%` }}
              className={cn(
                'absolute top-0 z-20 flex h-3/5 items-end justify-center rounded-b-[5px] bg-neutral-900 pb-1.5 text-[10px] text-white shadow-[0_2px_0_rgb(0_0_0/0.25)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-neutral-700 dark:bg-neutral-950 dark:active:bg-neutral-700',
                isRinged && 'inset-ring-2 inset-ring-brand-strong',
                isSelected &&
                  'bg-brand-strong font-semibold active:bg-brand-strong dark:bg-brand-strong dark:active:bg-brand-strong'
              )}
            >
              {isSelected ? noteName(midi) : ''}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** How long the piano note lasts, in seconds. */
const NOTE_SECONDS = 2.3
/** Its attack and its fade at the end, in seconds, so it starts and stops without a click. */
const ATTACK_SECONDS = 0.004
const FADE_SECONDS = 0.15
/** Its partials, up to this many and below this frequency. */
const MOST_PARTIALS = 40
const TOP_HZ = 6000
/** How sharp a string's overtones run: partial h sounds at h·f·√(1 + STRETCH·h²). */
const STRETCH = 0.00005
/**
 * A phone's speaker plays hardly anything below about 300 Hz, so a partial below this is turned
 * down, 12 dB an octave, as a piano's soundboard turns down its low strings' fundamentals. A low
 * key then keeps its pitch and level in the partials above it (#362).
 */
const SOUNDBOARD_HZ = 250
/** Above this, the hammer's partials fall off. */
const HAMMER_HZ = 3000
/**
 * How long a partial up to 400 Hz takes to fall to 1/e. One above it falls faster, in
 * DECAY_SECONDS × (400 Hz / its frequency)^0.7, so the note darkens as it rings.
 */
const DECAY_SECONDS = 0.9
/**
 * The note's RMS as it starts, −14 dBFS. Through a phone's speaker, every key is then about as
 * loud as the fixture farts of its octave (`piano-keys.test.ts`).
 */
const LEVEL = 0.2

/**
 * The piano note at `midi`, as samples at `sampleRate` (ADR 0015 rule 3): decaying partials of a
 * struck string, voiced for a phone's speaker. The one piano voice: `strikePianoNote` plays it.
 */
export function pianoNote(midi: number, sampleRate: number): Float32Array {
  const length = Math.round(NOTE_SECONDS * sampleRate)
  const samples = new Float32Array(length)
  const fundamental = 440 * 2 ** ((midi - 69) / 12)
  const top = Math.min(TOP_HZ, 0.45 * sampleRate)
  const partials: { frequency: number; level: number }[] = []
  for (let h = 1; h <= MOST_PARTIALS; h++) {
    const frequency = fundamental * h * Math.sqrt(1 + STRETCH * h * h)
    if (frequency > top) break
    const soundboard = frequency ** 2 / (frequency ** 2 + SOUNDBOARD_HZ ** 2)
    const hammer = 1 / (1 + (frequency / HAMMER_HZ) ** 2)
    partials.push({ frequency, level: (soundboard * hammer) / h })
  }
  const power = partials.reduce((sum, { level }) => sum + level ** 2 / 2, 0)
  const scale = LEVEL / Math.sqrt(power)
  partials.forEach(({ frequency, level }, i) => {
    // Each partial turns as a phasor that shrinks a little every sample: no Math.sin per sample.
    const step = (2 * Math.PI * frequency) / sampleRate
    const shrink = Math.exp(
      -1 / (DECAY_SECONDS * (400 / Math.max(frequency, 400)) ** 0.7 * sampleRate)
    )
    const c = Math.cos(step) * shrink
    const s = Math.sin(step) * shrink
    // Spread phases (Schroeder's), so the partials don't all peak together.
    const phase = (Math.PI * i * i) / partials.length
    let re = Math.cos(phase) * level * scale
    let im = Math.sin(phase) * level * scale
    for (let n = 0; n < length; n++) {
      samples[n] += im
      const next = re * c - im * s
      im = re * s + im * c
      re = next
    }
  })
  const attack = ATTACK_SECONDS * sampleRate
  const fade = FADE_SECONDS * sampleRate
  for (let n = 0; n < length; n++) {
    samples[n] *= Math.min(1, n / attack, (length - n) / fade)
  }
  return samples
}

/**
 * How many notes each context keeps built, each about 0.4 MB: no Song in the catalog has more
 * different notes than this.
 */
const MOST_BUILT = 16
/**
 * The notes built on each context, by MIDI note, the most recently used last. Building one takes a
 * few ms on the main thread, so the melody pays it once per note (#359). A context's sample rate
 * never changes, and a context replaced after a hide (`audioContext()`) takes its notes with it.
 */
const built = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>()

/** `pianoNote(midi, context.sampleRate)` as an AudioBuffer on `context`, built once. */
export function pianoBuffer(context: BaseAudioContext, midi: number): AudioBuffer {
  let notes = built.get(context)
  if (!notes) {
    notes = new Map()
    built.set(context, notes)
  }
  let buffer = notes.get(midi)
  if (buffer) {
    notes.delete(midi)
  } else {
    const samples = pianoNote(midi, context.sampleRate)
    buffer = context.createBuffer(1, samples.length, context.sampleRate)
    buffer.getChannelData(0).set(samples)
  }
  notes.set(midi, buffer)
  if (notes.size > MOST_BUILT) notes.delete(notes.keys().next().value as number)
  return buffer
}

/**
 * The piano note at `midi`, struck at `t` on `context`'s clock into `output`. It stops by itself
 * once it has rung out (`buffer.duration`), or sooner with `stop`. Song Creator's and a locked
 * Song's melody on piano (`piano-preview.ts`, #359) strikes it ahead of time.
 */
export function strikePianoNote(
  context: BaseAudioContext,
  output: AudioNode,
  midi: number,
  t: number
): AudioBufferSourceNode {
  const source = context.createBufferSource()
  source.buffer = pianoBuffer(context, midi)
  source.connect(output)
  source.start(t)
  return source
}

/**
 * Plays the piano note at `midi` on the shared AudioContext, from a tap, straight to the speakers:
 * a take's review.
 */
export function playPianoNote(midi: number): void {
  const context = audioContext()
  setPlaybackSession()
  context.resume().catch(() => {})
  strikePianoNote(context, context.destination, midi, context.currentTime)
}
