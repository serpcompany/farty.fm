'use client'

import { Check, ChevronLeft, ChevronRight, Play, RotateCcw, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { playbackPosition, stopPlayback } from '@/lib/audio/player'
import { noteName } from '@/lib/pitch'
import {
  foundNote,
  HIGHEST_PLACED_PITCH,
  LOWEST_PLACED_PITCH,
  MAXIMUM_NAME_LENGTH,
  type Recording,
  recordingName,
  samePart,
  type Trim
} from '@/lib/recordings'
import {
  choiceForKey,
  choiceForNoNote,
  foundHandles,
  type NoteChoice,
  openingHandles,
  type ReviewChange,
  type ReviewNote,
  reviewChange,
  reviewNote,
  savedChoice
} from '@/lib/take-review'
import { cn } from '@/lib/utils'
import type { PcmAudio } from '@/lib/wav'
import { octaveOf, PianoKeys, playPianoNote } from './piano-keys'
import { recordingSound, usePlayback } from './playback-provider'
import { useRecordFlow } from './record-flow-provider'
import { partLevels } from './recording-replay'
import { formattedTime, ReplayWaveform } from './waveform'

const FIRST_OCTAVE = 3
const LOWEST_OCTAVE = octaveOf(LOWEST_PLACED_PITCH)
const HIGHEST_OCTAVE = octaveOf(HIGHEST_PLACED_PITCH)

const keysOctave = (midi: number) =>
  Math.min(HIGHEST_OCTAVE, Math.max(LOWEST_OCTAVE, octaveOf(midi)))

type TakeReviewState = {
  recording: Recording
  choice: NoteChoice
  setChoice(choice: NoteChoice): void
  note: ReviewNote
  octave: number
  setOctave(octave: number): void
  handles: Trim
  setHandles(handles: Trim): void
  name: string
  setName(name: string): void
  change(): ReviewChange
}

export function useTakeReview(recording: Recording): TakeReviewState {
  const [choice, setChoice] = useState(() => savedChoice(recording))
  const note = reviewNote(recording, choice)
  const [octave, setOctave] = useState(() =>
    note.kind === 'note' ? keysOctave(note.midi) : FIRST_OCTAVE
  )
  const found = foundNote(recording)
  const [seenFound, setSeenFound] = useState(found)
  if (seenFound !== found) {
    setSeenFound(found)
    if (choice === null && found !== null) setOctave(keysOctave(found))
  }
  const opening = openingHandles(recording)
  const [handles, setHandles] = useState(opening)
  const [seen, setSeen] = useState(opening)
  if (!samePart(seen, opening)) {
    setSeen(opening)
    if (samePart(handles, seen)) setHandles(opening)
  }
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? recordingName(recording)
  return {
    recording,
    choice,
    setChoice,
    note,
    octave,
    setOctave,
    handles,
    setHandles,
    name,
    setName: setTyped,
    change: () => reviewChange(recording, { choice, handles, name })
  }
}

export function TakeReview({
  review,
  target,
  audio
}: {
  review: TakeReviewState
  target: 'draft' | Recording
  audio: PcmAudio | null
}) {
  const { nowPlaying, playingPart, togglePlayback, playRecording } = usePlayback()
  const { draftSound, retryAnalysis } = useRecordFlow()
  const soundOf = (part: Trim) =>
    target === 'draft' ? draftSound(part) : recordingSound(target, part)
  const { recording, handles, note } = review
  const isPlaying = nowPlaying === (target === 'draft' ? 'draft' : target.id)
  const { seconds } = recording
  const take = { startSeconds: 0, endSeconds: seconds }
  const levels = useMemo(
    () =>
      audio ? partLevels(audio, { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY }) : [],
    [audio]
  )
  const name = recordingName({ number: recording.number, name: review.name })
  const found = foundHandles(recording)
  const length = formattedTime(handles.endSeconds - handles.startSeconds)

  const stopHere = () => {
    if (isPlaying) stopPlayback()
  }
  const lit = note.kind === 'note' ? note.midi : null
  const heard = foundNote(recording)
  const ringed = heard !== null && heard !== lit ? heard : null
  const backToFound = () => {
    review.setChoice(null)
    if (heard !== null) review.setOctave(keysOctave(heard))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-1 pb-4">
      <section aria-label="Trim" className="flex flex-col gap-3.5 pt-2">
        <ReplayWaveform
          levels={levels}
          view={take}
          playing={isPlaying ? playingPart : null}
          position={playbackPosition}
          dim={handles}
          label={`Play ${name} from a spot`}
          onScrubStart={stopPlayback}
          onPlayFrom={from => {
            const to = from < handles.endSeconds - 0.01 ? handles.endSeconds : seconds
            const sound = to - from >= 0.02 && soundOf({ startSeconds: from, endSeconds: to })
            if (sound) playRecording(sound)
          }}
          trim={{
            part: handles,
            onChange: part => {
              stopHere()
              review.setHandles(part)
            }
          }}
          className="mx-2.5 h-22"
        />
        <div className="flex min-h-10 items-center gap-3">
          <Button
            className="h-10 rounded-full pr-4 pl-3 text-[15px]"
            aria-label={isPlaying ? 'Stop' : `Play the fart in ${name}, ${length}`}
            aria-pressed={isPlaying}
            data-testid="review-play"
            onClick={() => {
              const sound = soundOf(handles)
              if (sound) togglePlayback(sound)
            }}
          >
            {isPlaying ? <Square className="fill-current" /> : <Play className="fill-current" />}
            {isPlaying ? 'Stop' : 'Play'}
          </Button>
          <span className="text-[15px] font-semibold tabular-nums" data-testid="review-length">
            {length}
          </span>
          {samePart(handles, found) ? (
            <span className="ml-auto text-[13px] text-muted-foreground">
              Drag the pink ends to trim
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-brand-strong dark:text-brand"
              aria-label="Reset to the fart Farty found"
              onClick={() => {
                stopHere()
                review.setHandles(found)
              }}
            >
              <RotateCcw />
              Reset
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="review-note-label" className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3 pb-1">
          <div className="min-w-0">
            <p id="review-note-label" className="text-sm font-semibold text-muted-foreground">
              Note
            </p>
            <p
              className={cn(
                'flex h-[50px] items-center gap-2.5 font-bold tracking-tight tabular-nums',
                note.kind === 'note' && 'text-[46px]',
                note.kind === 'none' && 'text-[34px] text-muted-foreground',
                (note.kind === 'finding' || note.kind === 'notFound') &&
                  'text-2xl font-semibold text-muted-foreground'
              )}
              data-testid="review-note"
            >
              {note.kind === 'finding' && <Spinner aria-hidden className="size-5" />}
              {note.kind === 'note'
                ? noteName(note.midi)
                : note.kind === 'none'
                  ? 'No note'
                  : note.kind === 'notFound'
                    ? 'Not found'
                    : 'Finding note…'}
            </p>
          </div>
          <Button
            variant={note.kind === 'none' ? 'default' : 'outline'}
            className="h-[38px] shrink-0 rounded-full px-4 text-[15px]"
            aria-pressed={note.kind === 'none'}
            onClick={() => review.setChoice(choiceForNoNote(recording, review.choice))}
          >
            {note.kind === 'none' && <Check />}
            No note
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Octave down"
            disabled={review.octave <= LOWEST_OCTAVE}
            onClick={() => review.setOctave(review.octave - 1)}
          >
            <ChevronLeft />
          </Button>
          <p className="text-[15px] font-semibold" aria-live="polite" data-testid="review-octave">
            Octave {review.octave}
            <span className="ml-1.5 text-[13px] font-normal text-muted-foreground tabular-nums">
              C{review.octave} – B{review.octave}
            </span>
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Octave up"
            disabled={review.octave >= HIGHEST_OCTAVE}
            onClick={() => review.setOctave(review.octave + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <PianoKeys
          octave={review.octave}
          selected={lit}
          ringed={ringed}
          onKey={midi => {
            playPianoNote(midi)
            review.setChoice(choiceForKey(recording, midi))
          }}
        />
        <p
          className="min-h-10 pt-1 text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="review-caption"
        >
          <Caption
            note={note}
            heard={heard}
            recording={recording}
            onBack={backToFound}
            onRetry={target === 'draft' ? undefined : () => void retryAnalysis(target.id)}
          />
        </p>
      </section>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-name" className="text-sm font-semibold text-muted-foreground">
          Name
        </label>
        <Input
          id="review-name"
          value={review.name}
          maxLength={MAXIMUM_NAME_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          className="h-11 rounded-[10px] px-3 text-base md:text-base"
          onFocus={event => event.currentTarget.select()}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          onChange={event => review.setName(event.currentTarget.value)}
        />
      </div>
    </div>
  )
}

function Caption({
  note,
  heard,
  recording,
  onBack,
  onRetry
}: {
  note: ReviewNote
  heard: number | null
  recording: Recording
  onBack: () => void
  onRetry?: () => void
}) {
  const link = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="rounded-sm font-semibold text-brand-strong outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:text-brand"
      onClick={onClick}
    >
      {label}
    </button>
  )
  const back = (label: string) => link(label, onBack)
  if (note.kind === 'finding') return "You can save now. The note shows here once it's found."
  if (note.kind === 'notFound') {
    return onRetry ? (
      <>We couldn't find its note. Tap a key if you hear one, or {link('Retry', onRetry)}</>
    ) : (
      "We couldn't find its note. Tap a key if you hear one."
    )
  }
  if (note.kind === 'none') {
    if (heard !== null) {
      return (
        <>
          Songs leave it out. Tap a key to give it a note, or{' '}
          {back(`go back to ${noteName(heard)}`)}
        </>
      )
    }
    return recording.analysis.state === 'analyzed'
      ? 'No steady note found, so Songs leave it out. Tap a key if you hear one.'
      : 'Songs leave it out. Tap a key to give it a note.'
  }
  if (heard === null) return 'Set by you. Tap another key to change it.'
  if (note.midi === heard) {
    return `We heard ${noteName(heard)}. Tap a key to hear it and make it the note.`
  }
  return (
    <>
      Changed from {noteName(heard)}. {back(`Back to ${noteName(heard)}`)}
    </>
  )
}
