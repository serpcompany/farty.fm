'use client'

import { audioContext, setPlaybackSession } from '@/lib/audio/context'
import { noteName, pitchClassNames } from '@/lib/pitch'
import { cn } from '@/lib/utils'

const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]

const BLACK_KEYS = [
  { step: 1, afterWhiteKey: 1 },
  { step: 3, afterWhiteKey: 2 },
  { step: 6, afterWhiteKey: 4 },
  { step: 8, afterWhiteKey: 5 },
  { step: 10, afterWhiteKey: 6 }
]

const BLACK_WIDTH_PERCENT = 60 / WHITE_STEPS.length

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1
}

export function PianoKeys({
  octave,
  selected,
  placed,
  onKey
}: {
  octave: number
  selected: number | null
  placed: number | null
  onKey: (midi: number) => void
}) {
  const c = 12 * (octave + 1)
  const state = (midi: number) => ({
    isSelected: midi === selected,
    wasPlaced: midi === placed && midi !== selected
  })
  return (
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
        {BLACK_KEYS.map(({ step, afterWhiteKey }) => {
          const midi = c + step
          const { isSelected, wasPlaced } = state(midi)
          const center = (afterWhiteKey / WHITE_STEPS.length) * 100
          return (
            <button
              key={midi}
              type="button"
              aria-label={noteName(midi)}
              aria-pressed={isSelected}
              onClick={() => onKey(midi)}
              style={{
                left: `${center - BLACK_WIDTH_PERCENT / 2}%`,
                width: `${BLACK_WIDTH_PERCENT}%`
              }}
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

const PARTIALS = [
  { harmonic: 1, level: 1 },
  { harmonic: 2, level: 0.5 },
  { harmonic: 3, level: 0.28 },
  { harmonic: 4, level: 0.14 },
  { harmonic: 5, level: 0.08 },
  { harmonic: 6, level: 0.04 }
] as const

const STRING_INHARMONICITY = 0.0004

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
  for (const { harmonic, level } of PARTIALS) {
    const partial = context.createOscillator()
    partial.frequency.value =
      frequency * harmonic * (1 + STRING_INHARMONICITY * harmonic * harmonic)
    const gain = context.createGain()
    gain.gain.value = level * 0.3
    partial.connect(gain).connect(lowpass)
    partial.start(t)
    partial.stop(t + 2.3)
  }
  lowpass.connect(out).connect(context.destination)
}
