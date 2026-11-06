'use client'

import { useEffect, useState } from 'react'
import { loadSong } from '@/lib/catalog/load-songs'
import type { Song } from '@/lib/catalog/song'
import { formattedRecordedAt } from '@/lib/recordings'
import { noteSeconds, type SharedTootParts as Parts } from '@/lib/toot'
import { useInBrowser } from '@/lib/use-in-browser'
import { NoteView, pitchColor } from './note-view'
import { DeletedRecordingRow, PlaysBadge, RecordingUsedRowView } from './recording-used-row'
import type { SharedPlayer } from './shared-recording-page'

/**
 * What a shared Toot is made of, under its player (#443): its note roll, with a playhead while it
 * plays, and "Recordings used", each fart playing on its own. A note tapped plays from the Toot's
 * own audio, as on a Toot's screen. A Sound Pad Toot's roll is its taps, one lane per fart.
 */
export function SharedTootParts({ parts, player }: { parts: Parts; player: SharedPlayer }) {
  const { catalogSong, rows, transposition, lanes } = parts
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
  const fartPlaying = sound?.of === 'fart'
  const playingNote = sound?.of === 'item' ? sound.note : null
  const highlightedPitch = fartPlaying
    ? tapped
    : playingNote !== null
      ? (song?.notes[playingNote]?.pitch ?? null)
      : null
  const rowOf = (pitch: number) => rows.find(row => row.pitch === pitch)

  return (
    <div className="mt-5 flex flex-col gap-5">
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

      <section aria-labelledby="recordings-used">
        <h2 id="recordings-used" className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
          Recordings used
        </h2>
        <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">
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
            const isPlaying = fartPlaying && sound.place === fart.place && tapped === pitch
            const when = inBrowser ? formattedRecordedAt(fart.recordedAt) : null
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
                isPlaying={isPlaying}
                isHighlighted={isHighlighted}
                badge={badge}
                disabled={!fart.playable}
                onTap={() => {
                  setTapped(pitch)
                  if (isPlaying) player.stop()
                  else player.playFart(fart.place)
                }}
              />
            )
          })}
        </ul>
        {player.unplayable === 'fart' && (
          <p role="alert" className="px-4 pt-1.5 text-sm text-destructive">
            Couldn't play it. Check your connection and try again.
          </p>
        )}
      </section>
    </div>
  )
}
