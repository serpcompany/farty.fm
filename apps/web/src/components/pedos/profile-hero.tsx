'use client'

import { useEffect, useRef, useState } from 'react'
import { playbackPosition } from '@/lib/audio/player'
import { loadSong } from '@/lib/catalog/load-songs'
import type { RollSong, TootRoll } from '@/lib/toot'
import { cn } from '@/lib/utils'
import { Layout, pitchColor, useWidth } from './note-view'
import { Waveform } from './waveform'

// A profile page's hero (#448, the prototype's option C): a banner of the newest shared Toot's
// note roll, which the hero's Play plays, and a picture made from the Handle's first letter, since
// Farty keeps no photo.

/** The newest shared Toot's roll, as the page gets it: only its notes. */
export type HeroRoll = TootRoll & {
  /** Its row's path, which its audio is under. */
  path: string
}

/**
 * A Toot's notes to draw: its own, or, for a Toot saved before #254, which keeps none, its Song's
 * as they are now, as on its page. Null while they load, or with no roll (its Song isn't in Farty
 * any more).
 */
export function useRollSong(roll: TootRoll | null): RollSong | null {
  const [fetched, setFetched] = useState<{ id: string; song: RollSong } | null>(null)
  const catalogSong = roll?.catalogSong ?? null
  useEffect(() => {
    if (!catalogSong) return
    let live = true
    loadSong(catalogSong).then(
      song => live && setFetched({ id: catalogSong.id, song }),
      () => {}
    )
    return () => {
      live = false
    }
  }, [catalogSong])
  if (roll?.song) return roll.song
  return catalogSong && fetched?.id === catalogSong.id ? fetched.song : null
}

/** The letter a Handle's picture shows: its first letter or digit, as a capital. */
export function pictureLetter(handle: string): string {
  return (handle.match(/[a-z0-9]/i)?.[0] ?? handle[0] ?? '?').toUpperCase()
}

/** A round picture of the Handle's first letter, in Farty's pink. */
export function LetterPicture({ handle, className }: { handle: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Picture for @${handle}`}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-brand-strong font-bold text-white select-none',
        className
      )}
      data-testid="profile-picture"
    >
      <span aria-hidden>{pictureLetter(handle)}</span>
    </div>
  )
}

/**
 * The banner: the Toot's note roll, with a playhead while it plays from its start, or, when it
 * has no roll (its Song isn't in Farty any more), its waveform.
 */
export function RollBanner({
  roll,
  levels,
  playing,
  className
}: {
  roll: HeroRoll
  /** The Toot's loudness bars, for a Toot with no roll. */
  levels: number[] | null
  /** Whether the Toot plays now, from its start. */
  playing: boolean
  className?: string
}) {
  const song = useRollSong(roll)
  return (
    <div
      className={cn('relative overflow-hidden bg-muted/60', className)}
      data-testid="profile-banner"
    >
      <div className="absolute inset-x-4 top-3.5 bottom-4 md:inset-x-8 md:top-7 md:bottom-8">
        {song ? (
          <RollArt song={song} played={roll.played} playing={playing} />
        ) : (
          levels && <Waveform levels={levels} isPlaying={playing} className="h-full" />
        )}
      </div>
    </div>
  )
}

/** Where the sound playing is, in seconds, every frame while `playing`; null when it isn't. */
export function usePlayingSeconds(playing: boolean): number | null {
  const [seconds, setSeconds] = useState<number | null>(null)
  useEffect(() => {
    if (!playing) {
      setSeconds(null)
      return
    }
    let frame = 0
    const tick = () => {
      setSeconds(playbackPosition())
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [playing])
  return seconds
}

/**
 * The roll, drawn as the Toot's page draws it (`NoteView`'s layout and colors) but only to look
 * at, filling its parent: the banner's or row's Play plays it, and the Toot's own page is where a
 * note plays on its own.
 */
export function RollArt({
  song,
  played,
  playing
}: {
  song: RollSong
  played: number[]
  playing: boolean
}) {
  const area = useRef<HTMLDivElement>(null)
  const width = useWidth(area)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const target = area.current
    if (!target) return
    setHeight(target.clientHeight)
    const observer = new ResizeObserver(() => setHeight(target.clientHeight))
    observer.observe(target)
    return () => observer.disconnect()
  }, [])
  const seconds = usePlayingSeconds(playing)
  const beat = seconds === null ? null : (seconds * song.bpm) / 60
  const layout = new Layout(song, width, height)
  const colorIndex = (pitch: number) => Math.max(0, song.pitches.indexOf(pitch))
  const isPlayed = new Set(played)

  return (
    <div ref={area} className="absolute inset-0" data-testid="profile-banner-roll">
      {width > 0 && height > 0 && (
        <svg
          width={width}
          height={height}
          aria-hidden="true"
          className="absolute inset-0 overflow-visible"
        >
          {song.notes.map((note, index) => {
            const r = layout.rect(note)
            const color = pitchColor(colorIndex(note.pitch))
            // A note no fart plays, left out of the Toot (#360): hollow, as on its own page.
            const isGap = !isPlayed.has(note.pitch)
            const sounding = beat !== null && note.start <= beat && beat < note.start + note.dur
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: a Song's notes are fixed
                key={index}
                x={r.x}
                y={r.y}
                width={r.width}
                height={r.height}
                rx={r.height / 2}
                fill={isGap ? 'none' : color}
                stroke={isGap ? color : undefined}
                strokeWidth={isGap ? 1.5 : undefined}
                strokeDasharray={isGap ? '3 2' : undefined}
                opacity={beat === null || sounding ? 1 : 0.45}
              />
            )
          })}
          {beat !== null && beat <= layout.beats && (
            <rect
              x={layout.x(beat) - 1}
              y={0}
              width={2}
              height={height}
              className="fill-foreground"
              data-testid="profile-banner-playhead"
            />
          )}
        </svg>
      )}
    </div>
  )
}
