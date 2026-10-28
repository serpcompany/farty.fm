'use client'

import { audioContext, setPlaybackSession } from '@/lib/audio/context'
import { noteName, pitchClassNames } from '@/lib/pitch'
import { cn } from '@/lib/utils'

// One octave of piano keys for placing a Noise-like Recording by ear (ADR 0015), and the piano
// note each key plays. The note sounds only here, to compare the fart with: Songs and Toots never
// play it, and stay fart-only (AGENTS.md).

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
 * the others name only the letter. The key picked is filled; the note the fart is placed on now,
 * if it isn't the one picked, is ringed.
 */
export function PianoKeys({
  octave,
  selected,
  placed,
  onKey
}: {
  octave: number
  /** The key picked, as a MIDI note, or null. */
  selected: number | null
  /** The note the fart is placed on now, or null. */
  placed: number | null
  onKey: (midi: number) => void
}) {
  const c = 12 * (octave + 1)
  const state = (midi: number) => ({
    isSelected: midi === selected,
    wasPlaced: midi === placed && midi !== selected
  })
  return (
    // The fieldset only names the keys: Chrome lays a fieldset's children out in a box of its own,
    // which doesn't take the fieldset's height, so the keys' layout is the div inside.
    <fieldset className="min-w-0">
      <legend className="sr-only">Piano</legend>
      <div className="relative flex h-42 touch-manipulation">
        {WHITE_STEPS.map(step => {
          const midi = c + step
          const { isSelected, wasPlaced } = state(midi)
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
                wasPlaced && 'inset-ring-2 inset-ring-brand-strong',
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
          const { isSelected, wasPlaced } = state(midi)
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
                wasPlaced && 'inset-ring-2 inset-ring-brand-strong',
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

/** Each partial of the piano note: its harmonic and level. */
const PARTIALS = [
  [1, 1],
  [2, 0.5],
  [3, 0.28],
  [4, 0.14],
  [5, 0.08],
  [6, 0.04]
] as const

/**
 * Plays a piano note at `midi` on the shared AudioContext, from a tap: a few decaying partials,
 * enough to hold the fart up to. Only the place-by-ear picker plays it.
 */
export function playPianoNote(midi: number): void {
  const context = audioContext()
  setPlaybackSession()
  context.resume().catch(() => {})
  const t = context.currentTime
  const frequency = 440 * 2 ** ((midi - 69) / 12)

  const out = context.createGain()
  out.gain.setValueAtTime(0.0001, t)
  out.gain.exponentialRampToValueAtTime(0.6, t + 0.008)
  out.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.setValueAtTime(Math.min(frequency * 9, 9000), t)
  lowpass.frequency.exponentialRampToValueAtTime(Math.max(frequency * 2.5, 400), t + 1.4)
  for (const [harmonic, level] of PARTIALS) {
    const partial = context.createOscillator()
    // A real string's overtones run a little sharp.
    partial.frequency.value = frequency * harmonic * (1 + 0.0004 * harmonic * harmonic)
    const gain = context.createGain()
    gain.gain.value = level * 0.3
    partial.connect(gain).connect(lowpass)
    partial.start(t)
    partial.stop(t + 2.3)
  }
  lowpass.connect(out).connect(context.destination)
}
