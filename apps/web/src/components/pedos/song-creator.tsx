'use client'

import { Check, ChevronLeft, Play, Square, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Song } from '@/lib/catalog/song'
import { noteName } from '@/lib/pitch'
import * as store from '@/lib/recording-store'
import { formattedLength, type Recording, recordingName, recordingPitch } from '@/lib/recordings'
import { noteCaption, soundingPitch, type TootDraft } from '@/lib/toot'
import { TootError } from '@/lib/toot-renderer'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { NoteView, pitchColor } from './note-view'
import { tootPlayback, usePedos } from './pedos-provider'
import { previousPage } from './previous-page'
import { Waveform } from './waveform'

type Phase =
  | { kind: 'making' }
  | { kind: 'ready'; draft: TootDraft }
  | { kind: 'locked' }
  | { kind: 'failed' }

/**
 * Song Creator: hear an Unlocked Song played by your Recordings, and keep it as a Toot. It's not
 * an editor: nothing here changes the Arrangement (ADR 0005). As the iPhone app's
 * `SongCreatorView`.
 */
export function SongCreator({ song }: { song: Song }) {
  const pedos = usePedos()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'making' })
  /** Bumped by Try again, to make the Toot again. */
  const [attempt, setAttempt] = useState(0)
  const loaded = pedos.recordings !== null

  const make = useEffectEvent(() => pedos.makeToot(song))
  const playOnce = useEffectEvent((draft: TootDraft) => {
    // A page opened from a link or a reload can't start sound before a tap.
    if (navigator.userActivation?.hasBeenActive ?? true) pedos.toggleTootPlayback(draft)
  })

  // Makes the Toot once the Recordings have loaded, then plays it once. Leaving the screen
  // before it's made drops it; coming back makes it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what Try again changes.
  useEffect(() => {
    if (!loaded) return
    let left = false
    make().then(
      draft => {
        if (left) return
        setPhase({ kind: 'ready', draft })
        playOnce(draft)
      },
      error => {
        if (left) return
        setPhase({
          kind: error instanceof TootError && error.reason === 'locked' ? 'locked' : 'failed'
        })
      }
    )
    return () => {
      left = true
    }
  }, [loaded, attempt])

  const { stopPlayback, forgetToot } = pedos
  useEffect(() => stopPlayback, [stopPlayback])
  const draftId = phase.kind === 'ready' ? phase.draft.id : null
  useEffect(() => {
    if (draftId) return () => forgetToot(draftId)
  }, [draftId, forgetToot])

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 px-2 pt-2 pb-3">
        {/* Back to the Compose it came from, or in its place, so the system Back never opens
            this Toot again. */}
        <Link
          href="/compose/"
          replace
          onClick={event => {
            if (previousPage()?.replace(/\/$/, '') !== '/compose') return
            event.preventDefault()
            router.back()
          }}
          aria-label="Back to Compose"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
        >
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0 text-center">
          <h1 className="truncate font-semibold">{song.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{song.source}</p>
        </div>
      </header>

      {phase.kind === 'making' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Spinner className="size-6" />
          <p>Making your Toot…</p>
        </div>
      )}
      {phase.kind === 'locked' && (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          This Song is locked. Record the notes it needs to unlock it.
        </p>
      )}
      {phase.kind === 'failed' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-muted-foreground">Couldn't make this Toot.</p>
          <Button
            variant="outline"
            className="h-11 px-5 text-base"
            onClick={() => {
              setPhase({ kind: 'making' })
              setAttempt(a => a + 1)
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {phase.kind === 'ready' && <Ready draft={phase.draft} />}
    </div>
  )
}

/** The made Toot, with Save to Toots pinned above the tabs. */
function Ready({ draft }: { draft: TootDraft }) {
  const pedos = usePedos()
  const isSaved = pedos.toot(draft.id) !== undefined
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const save = async () => {
    setSaving(true)
    setSaveFailed(false)
    try {
      await pedos.saveToot(draft)
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TootLayout draft={draft} />
      <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] mt-auto bg-linear-to-t from-background from-70% to-transparent px-5 pt-5 pb-3">
        <Button className="h-12 w-full text-base" disabled={isSaved || saving} onClick={save}>
          {isSaved ? (
            <>
              <Check className="size-5" />
              Saved to Toots
            </>
          ) : (
            'Save to Toots'
          )}
        </Button>
        {saveFailed && (
          <p className="pt-2 text-center text-sm text-muted-foreground">Couldn't save this Toot.</p>
        )}
      </div>
    </>
  )
}

/** A Recording's notes (by the Song pitch it plays), or one note, stand out. */
type Focus = { pitch: number } | { note: number } | null

/**
 * Play, the note view, and the Recordings used: tap a Recording to hear it alone and see which
 * notes it plays; tap a note to hear just that note as rendered, with what it is and how far its
 * Recording moved. As the iPhone app's `TootLayout`.
 */
export function TootLayout({ draft }: { draft: TootDraft }) {
  const pedos = usePedos()
  const { song, arrangement } = draft
  const [focus, setFocus] = useState<Focus>(null)
  const isPlaying = pedos.nowPlaying === tootPlayback(draft.id)
  const playingNote = song.notes.findIndex((_, i) => pedos.nowPlaying === tootPlayback(draft.id, i))
  const selectedNote = focus && 'note' in focus ? focus.note : null
  const highlightedPitch =
    focus === null ? null : 'pitch' in focus ? focus.pitch : song.notes[focus.note].pitch
  const recordingFor = (pitch: number) => {
    const id = arrangement.recordingForPitch[pitch]
    return id === undefined ? undefined : pedos.recording(id)
  }

  return (
    <div className="flex flex-col gap-6 px-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={isPlaying ? 'Stop' : 'Play'}
          data-testid="song-creator-play"
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
          )}
          onClick={() => {
            setFocus(null)
            pedos.toggleTootPlayback(draft)
          }}
        >
          {isPlaying ? (
            <Square className="size-5 fill-current" />
          ) : (
            <Play className="size-6 fill-current" />
          )}
        </button>
        <div className="min-w-0">
          <p className="font-semibold" data-testid="song-creator-state">
            {isPlaying ? 'Playing' : 'Ready'}
          </p>
          <p className="text-sm text-muted-foreground">
            {song.pitches.length} of your Recordings, one per note
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <NoteView
          song={song}
          arrangement={arrangement}
          recordingName={note => {
            const recording = recordingFor(note.pitch)
            return recording ? recordingName(recording) : 'Recording deleted'
          }}
          startedAt={isPlaying ? pedos.playbackStartedAt : null}
          highlightedPitch={highlightedPitch}
          selectedNote={selectedNote}
          playingNote={playingNote === -1 ? null : playingNote}
          onTapNote={index => {
            setFocus({ note: index })
            pedos.toggleTootPlayback(draft, index)
          }}
        />
        {selectedNote !== null && (
          <p className="px-4 text-sm text-muted-foreground" data-testid="note-caption">
            {noteCaption(
              song,
              arrangement,
              song.notes[selectedNote],
              recordingFor(song.notes[selectedNote].pitch)
            )}
          </p>
        )}
      </div>

      <section aria-labelledby="recordings-used">
        <h2 id="recordings-used" className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
          Recordings used
        </h2>
        <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">
          {song.pitches.map((pitch, index) => {
            const recording = recordingFor(pitch)
            const plays = noteName(soundingPitch(arrangement, pitch))
            const isHighlighted = highlightedPitch === pitch
            return recording ? (
              <RecordingUsedRow
                key={pitch}
                recording={recording}
                color={pitchColor(index)}
                plays={plays}
                isHighlighted={isHighlighted}
                onTap={() => {
                  const stopping = pedos.nowPlaying === recording.id
                  setFocus(stopping ? null : { pitch })
                  pedos.togglePlayback(recording)
                }}
              />
            ) : (
              <DeletedRecordingRow
                key={pitch}
                color={pitchColor(index)}
                plays={plays}
                isHighlighted={isHighlighted}
              />
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/**
 * A Recording the Toot uses: the color of its notes, play, its name, its waveform and length, and
 * the note it plays in the Song. As the iPhone app's `RecordingRow` in Song Creator.
 */
function RecordingUsedRow({
  recording,
  color,
  plays,
  isHighlighted,
  onTap
}: {
  recording: Recording
  color: string
  plays: string
  isHighlighted: boolean
  onTap: () => void
}) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const levels = useWholeLevels(recording.id)
  const name = recordingName(recording)
  const pitch = recordingPitch(recording)
  const length = formattedLength(recording.seconds)

  return (
    <li
      className={cn(
        'flex items-center gap-3 py-2 pr-4 pl-4',
        (isPlaying || isHighlighted) && 'bg-primary/10'
      )}
      data-testid="recording-used"
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={[
          name,
          `plays ${plays}`,
          length,
          isHighlighted && 'highlighted',
          pitch === null ? 'noise-like' : noteName(pitch)
        ]
          .filter(Boolean)
          .join(', ')}
        aria-pressed={isPlaying}
        onClick={onTap}
      >
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span
          aria-hidden
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
          )}
        >
          {isPlaying ? (
            <Square className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span>{name}</span>
          <span className="flex items-center gap-2">
            <Waveform
              levels={levels}
              isPlaying={isPlaying}
              className="h-[18px] w-[72px] gap-[1.5px]"
            />
            <span className="text-sm text-muted-foreground">{length}</span>
          </span>
        </span>
      </button>
      <PlaysBadge plays={plays} />
    </li>
  )
}

/** A Recording the Toot used that has since been deleted: the note it played, and no play button. */
function DeletedRecordingRow({
  color,
  plays,
  isHighlighted
}: {
  color: string
  plays: string
  isHighlighted: boolean
}) {
  return (
    <li
      className={cn(
        'flex min-h-15 items-center gap-3 py-2 pr-4 pl-4',
        isHighlighted && 'bg-primary/10'
      )}
      data-testid="recording-used"
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Trash2 className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-muted-foreground">Recording deleted</span>
      <PlaysBadge plays={plays} />
    </li>
  )
}

/** "plays F3": the note a Recording plays in the Song. */
function PlaysBadge({ plays }: { plays: string }) {
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold tabular-nums"
    >
      plays {plays}
    </span>
  )
}

/** 16 loudness bars of the whole Recording, as the iPhone's Song Creator rows show it. */
function useWholeLevels(id: string): number[] {
  const [levels, setLevels] = useState<number[]>([])
  useEffect(() => {
    let left = false
    store
      .loadAudio(id)
      .then(wav => {
        if (!left) setLevels(waveformLevels(decodeWav(wav).samples, 16))
      })
      .catch(() => {})
    return () => {
      left = true
    }
  }, [id])
  return levels
}
