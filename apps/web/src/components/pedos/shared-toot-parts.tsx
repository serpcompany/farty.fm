'use client'

import { useEffect, useState } from 'react'
import { loadSong } from '@/lib/catalog/load-songs'
import type { Song } from '@/lib/catalog/song'
import { recordedWhenAndWhere } from '@/lib/fart-place'
import { noteSeconds, type SharedTootParts as Parts } from '@/lib/toot'
import { useInBrowser } from '@/lib/use-in-browser'
import { NoteView, pitchColor } from './note-view'
import {
  DeletedRecordingRow,
  PlaysBadge,
  RecordingsUsed,
  RecordingUsedRowView
} from './recording-used-row'
import { TootPlay } from './toot-play'
import { useSharedPlayer } from './use-shared-player'

const tryAgain = 'Check your connection and try again.'

/**
 * A shared Toot as the screen it was made on (#443, #451), with Song Creator's own parts: Play,
 * with "Ready" or "Playing", then its note roll, with a playhead while it plays, then "Recordings
 * used", each fart playing on its own. A note tapped plays from the Toot's own audio, as on a
 * Toot's screen. A Sound Pad Toot's roll is its taps, one lane per fart. `base` is the page's own
 * path, which its audio is under.
 */
export function SharedTootParts({
  handle,
  base,
  title,
  length,
  seconds,
  parts
}: {
  handle: string
  base: string
  title: string
  /** "0:18". */
  length: string
  seconds: number
  parts: Parts
}) {
  const { catalogSong, rows, transposition, lanes } = parts
  const player = useSharedPlayer(base, { startSeconds: 0, endSeconds: seconds })
  const [fetched, setFetched] = useState<Song | null>(null)
  /** The pitch of the row last tapped: a Recording can play two. */
  const [tapped, setTapped] = useState<number | null>(null)
  const inBrowser = useInBrowser()

  // A Toot saved before #254 keeps no notes, so they're its Song's as they are now. The page does
  // without its roll when they can't be fetched.
  useEffect(() => {
    if (catalogSong) void loadSong(catalogSong).then(setFetched, () => {})
  }, [catalogSong])

  const song = parts.song ?? fetched
  const { sound } = player
  const isPlaying = sound?.of === 'item' && sound.note === null
  const fartPlaying = sound?.of === 'fart'
  const playingNote = sound?.of === 'item' ? sound.note : null
  const highlightedPitch = fartPlaying
    ? tapped
    : playingNote !== null
      ? (song?.notes[playingNote]?.pitch ?? null)
      : null
  const rowOf = (pitch: number) => rows.find(row => row.pitch === pitch)

  return (
    <div className="mt-6 flex flex-col gap-6">
      <TootPlay
        shows={isPlaying ? 'stop' : 'play'}
        label={`${isPlaying ? 'Stop' : 'Play'} ${title}`}
        onPress={() => (isPlaying ? player.stop() : player.playFrom(0))}
        state={isPlaying ? 'Playing' : player.unplayable === 'item' ? "Couldn't play" : 'Ready'}
        line={`${length} · ${rows.length} of @${handle}'s Recordings${lanes ? '' : ', one per note'}`}
        testId="shared-toot"
      >
        {player.unplayable === 'item' && (
          <p role="alert" className="text-sm text-destructive">
            {tryAgain}
          </p>
        )}
      </TootPlay>

      {song && (
        <NoteView
          song={song}
          arrangement={{
            transposition,
            recordingForPitch: Object.fromEntries(rows.map((row, i) => [row.pitch, String(i)]))
          }}
          recordingName={note => {
            const row = rowOf(note.pitch)
            return row ? (row.fart?.name ?? 'Recording deleted') : 'No fart'
          }}
          startedAt={player.startedAt}
          highlightedPitch={highlightedPitch}
          selectedNote={playingNote}
          playingNote={playingNote}
          lanes={lanes}
          onTapNote={index => {
            if (playingNote === index) return player.stop()
            const { start, length } = noteSeconds(song, song.notes[index])
            player.playNote(index, start, start + length)
          }}
        />
      )}

      <RecordingsUsed
        footer={
          player.unplayable === 'fart' && (
            <p role="alert" className="px-4 pt-1.5 text-sm text-destructive">
              Couldn't play it. {tryAgain}
            </p>
          )
        }
      >
        {rows.map(row => {
          const { fart, pitch, plays } = row
          const color = pitchColor(row.colorIndex)
          const isHighlighted = highlightedPitch === pitch
          const badge = plays && <PlaysBadge plays={plays} />
          if (!fart) {
            return (
              <DeletedRecordingRow
                key={pitch}
                color={color}
                isHighlighted={isHighlighted}
                badge={badge}
              />
            )
          }
          const isFartPlaying = fartPlaying && sound.place === fart.place && tapped === pitch
          // The day and town on one line, as short as Song Creator's rows allow (#451).
          const when = inBrowser
            ? recordedWhenAndWhere(fart.recordedAt, fart, { time: false })
            : null
          return (
            <RecordingUsedRowView
              key={pitch}
              name={fart.name}
              length={fart.length}
              levels={fart.levels}
              color={color}
              label={[fart.name, plays && `plays ${plays}`, fart.length, when]
                .filter(Boolean)
                .join(', ')}
              when={when}
              isPlaying={isFartPlaying}
              isHighlighted={isHighlighted}
              badge={badge}
              disabled={!fart.playable}
              onTap={() => {
                setTapped(pitch)
                if (isFartPlaying) player.stop()
                else player.playFart(fart.place)
              }}
            />
          )
        })}
      </RecordingsUsed>
    </div>
  )
}
