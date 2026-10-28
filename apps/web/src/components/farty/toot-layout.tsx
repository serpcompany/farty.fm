'use client'

import { CircleAlert, Play, Square, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { Song } from '@/lib/catalog/song'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { loadAudio } from '@/lib/recording-store'
import { type Recording, recordingName, recordingPitch } from '@/lib/recordings'
import { noteCaption, soundingPitch, type Toot, type TootDraft } from '@/lib/toot'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { NoteView, pitchColor } from './note-view'
import { recordingSound, usePlayback } from './playback-provider'
import { useRecordings } from './recordings-provider'
import { tootPlayback, useToots } from './toots-provider'
import { Waveform } from './waveform'

type Focus = { pitch: number } | { note: number } | null

function playState(isAudioMissing: boolean, isPlaying: boolean, playFailed: boolean): string {
  if (isAudioMissing) return 'Audio missing'
  if (isPlaying) return 'Playing'
  return playFailed ? "Couldn't play" : 'Ready'
}

export function TootLayout({
  toot,
  song,
  isAudioMissing = false,
  children
}: {
  toot: TootDraft | Toot
  song: Song
  isAudioMissing?: boolean
  children?: ReactNode
}) {
  const { nowPlaying, playbackStartedAt, togglePlayback } = usePlayback()
  const { toggleTootPlayback, tootPlayFailed } = useToots()
  const { recording } = useRecordings()
  const { arrangement } = toot
  const [focus, setFocus] = useState<Focus>(null)
  const isPlaying = nowPlaying === tootPlayback(toot.id)
  const playingNote = song.notes.findIndex((_, i) => nowPlaying === tootPlayback(toot.id, i))
  const selectedNote = focus && 'note' in focus ? focus.note : null
  const highlightedPitch =
    focus === null ? null : 'pitch' in focus ? focus.pitch : song.notes[focus.note].pitch
  const recordingFor = (pitch: number) => {
    const id = arrangement.recordingForPitch[pitch]
    return id === undefined ? undefined : recording(id)
  }

  return (
    <div className="flex flex-col gap-6 px-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={isAudioMissing ? 'Audio missing' : isPlaying ? 'Stop' : 'Play'}
          data-testid="song-creator-play"
          disabled={isAudioMissing}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            isAudioMissing
              ? 'bg-muted text-muted-foreground'
              : isPlaying
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/10 text-primary'
          )}
          onClick={() => {
            setFocus(null)
            toggleTootPlayback(toot)
          }}
        >
          {isAudioMissing ? (
            <CircleAlert className="size-6" />
          ) : isPlaying ? (
            <Square className="size-5 fill-current" />
          ) : (
            <Play className="size-6 fill-current" />
          )}
        </button>
        <div className="min-w-0">
          <p className="font-semibold" data-testid="song-creator-state">
            {playState(isAudioMissing, isPlaying, tootPlayFailed === toot.id)}
          </p>
          <p className="text-sm text-muted-foreground">
            {song.pitches.length} of your Recordings, one per note
          </p>
          {children}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <NoteView
          song={song}
          arrangement={arrangement}
          recordingName={note => {
            const used = recordingFor(note.pitch)
            return used ? recordingName(used) : 'Recording deleted'
          }}
          startedAt={isPlaying ? playbackStartedAt : null}
          highlightedPitch={highlightedPitch}
          selectedNote={selectedNote}
          playingNote={playingNote === -1 ? null : playingNote}
          onTapNote={index => {
            if (isAudioMissing) return
            setFocus({ note: index })
            toggleTootPlayback(toot, index)
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
            const used = recordingFor(pitch)
            const plays = noteName(soundingPitch(arrangement, pitch))
            const isHighlighted = highlightedPitch === pitch
            return used ? (
              <RecordingUsedRow
                key={pitch}
                recording={used}
                color={pitchColor(index)}
                plays={plays}
                isHighlighted={isHighlighted}
                onTap={() => {
                  const stopping = nowPlaying === used.id
                  setFocus(stopping ? null : { pitch })
                  togglePlayback(recordingSound(used))
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
  const { nowPlaying } = usePlayback()
  const isPlaying = nowPlaying === recording.id
  const levels = useWholeLevels(recording.id)
  const name = recordingName(recording)
  const pitch = recordingPitch(recording)
  const length = formattedFartLength(recording)

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
        <ColorDot color={color} />
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
      <ColorDot color={color} />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Trash2 className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-muted-foreground">Recording deleted</span>
      <PlaysBadge plays={plays} />
    </li>
  )
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

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

function useWholeLevels(id: string): number[] {
  const [levels, setLevels] = useState<number[]>([])
  useEffect(() => {
    let left = false
    loadAudio(id)
      .then(wav => {
        if (!left) setLevels(waveformLevels(decodeWav(wav).samples, 16))
      })
      .catch(() => undefined)
    return () => {
      left = true
    }
  }, [id])
  return levels
}
