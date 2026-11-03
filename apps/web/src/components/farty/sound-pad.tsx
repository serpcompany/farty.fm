'use client'

import { AudioLines } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import {
  keepPadSounds,
  loadPadSound,
  PadAudioUnavailable,
  playPadSound,
  stopPadSounds
} from '@/lib/audio/pad-player'
import { loadPads, savePads } from '@/lib/pad-store'
import { type AssignedPads, assignPad, PAD_COUNT, type PadMapping, padMapping } from '@/lib/pads'
import { loadAudio } from '@/lib/recording-store'
import { reportError } from '@/lib/telemetry/errors'
import { openVisit } from '@/lib/visit'
import { BackLink } from './back-link'
import { Pad, type PadSound } from './pad'
import { PadChooser } from './pad-chooser'
import { PadTakeControls } from './pad-take'
import { usePageHidden } from './page-hidden'
import { useRecordings } from './recordings-provider'
import { SaveToToots } from './save-to-toots'
import { usePadTake } from './use-pad-take'

const padNumbers = Array.from({ length: PAD_COUNT }, (_, pad) => pad)

function useAssignedPads() {
  const [assigned, setAssigned] = useState<AssignedPads | null>(null)
  useEffect(() => {
    let left = false
    openVisit()
      .library.then(loadPads)
      .catch(error => {
        reportError('pad-mapping-failed', error)
        return new Map<number, string>()
      })
      .then(pads => {
        if (!left) setAssigned(pads)
      })
    return () => {
      left = true
    }
  }, [])
  return [assigned, setAssigned] as const
}

function usePadSounds(mapping: PadMapping | null) {
  const [sounds, setSounds] = useState<ReadonlyMap<string, AudioBuffer>>(new Map())
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const load = useCallback((id: string, left: () => boolean) => {
    loadPadSound(id, () => loadAudio(id)).then(
      sound => {
        if (!left()) setSounds(current => new Map(current).set(id, sound))
      },
      error => {
        if (left()) return
        setFailed(current => new Set(current).add(id))
        if (!(error instanceof PadAudioUnavailable)) reportError('pad-sound-failed', error)
      }
    )
  }, [])
  const onPads = [...new Set(mapping)]
    .filter(id => id !== null)
    .sort()
    .join(' ')
  useEffect(() => {
    const ids = new Set(onPads.split(' ').filter(Boolean))
    keepPadSounds(ids)
    setSounds(current =>
      [...current.keys()].every(id => ids.has(id))
        ? current
        : new Map([...current].filter(([id]) => ids.has(id)))
    )
    setFailed(current => (current.size === 0 ? current : new Set()))
    let left = false
    for (const id of ids) load(id, () => left)
    return () => {
      left = true
    }
  }, [onPads, load])

  const stateOf = (id: string | null): PadSound => {
    if (id === null) return undefined
    if (sounds.has(id)) return 'ready'
    return failed.has(id) ? 'unavailable' : 'loading'
  }
  const loadAgain = (id: string) => {
    if (!failed.has(id)) return
    setFailed(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    load(id, () => false)
  }
  return { sounds, stateOf, loadAgain }
}

export function SoundPad() {
  const { recordings, recording: recordingOf } = useRecordings()
  const [assigned, setAssigned] = useAssignedPads()
  const [editing, setEditing] = useState(false)
  const [choosing, setChoosing] = useState<number | null>(null)
  const [playing, setPlaying] = useState<readonly number[]>(() => Array(PAD_COUNT).fill(0))
  const take = usePadTake()
  const recording = take.phase.kind === 'recording'
  const mapping = recordings && assigned ? padMapping(recordings, assigned) : null
  const { sounds, stateOf, loadAgain } = usePadSounds(mapping)

  usePageHidden(() => {
    stopPadSounds()
    setChoosing(null)
  })
  useEffect(() => stopPadSounds, [])

  const counted = (pad: number, by: number) =>
    setPlaying(current => current.map((count, i) => (i === pad ? Math.max(0, count + by) : count)))
  const play = (pad: number, id: string, at: number) => {
    const sound = sounds.get(id)
    if (!sound) {
      loadAgain(id)
      return
    }
    playPadSound(sound, () => counted(pad, -1))
    counted(pad, 1)
    take.tapped(at, id)
  }
  const assign = (pad: number, id: string) => {
    if (!mapping) return
    const next = assignPad(mapping, pad, id)
    setAssigned(next)
    savePads(next).catch(error => reportError('pad-mapping-failed', error))
  }

  const loaded = mapping !== null
  const hasRecordings = (recordings?.length ?? 0) > 0

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 px-2 pt-2 pb-3">
        <BackLink href="/compose/" label="Back to Compose" />
        <h1 className="truncate text-center font-semibold">Sound Pad</h1>
        {loaded && hasRecordings && !recording && (
          <Button
            variant="ghost"
            className="h-11 justify-self-end px-3 text-base"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </header>

      {!loaded && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}
      {loaded && !hasRecordings && (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AudioLines />
            </EmptyMedia>
            <EmptyTitle>No Recordings yet</EmptyTitle>
            <EmptyDescription>
              Go to the Record tab and tap the red button. Your farts fill the Pads.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {loaded && hasRecordings && (
        <div className="flex flex-col gap-3 px-4 pb-6">
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {editing
              ? 'Tap a Pad to choose its fart.'
              : recording
                ? 'Recording what you play.'
                : 'Tap the Pads to play your farts.'}
          </p>
          <ul className="grid grid-cols-3 gap-3 md:grid-cols-4" data-testid="pads">
            {padNumbers.map(pad => {
              const id = mapping[pad]
              return (
                <li key={pad} className="contents">
                  <Pad
                    pad={pad}
                    recording={id === null ? undefined : recordingOf(id)}
                    sound={stateOf(id)}
                    playing={playing[pad] > 0}
                    editing={editing}
                    onPlay={at => id !== null && play(pad, id, at)}
                    onChoose={() => setChoosing(pad)}
                  />
                </li>
              )
            })}
          </ul>
          <div className="pt-3">
            <PadTakeControls take={take} disabled={editing} />
          </div>
        </div>
      )}
      {take.phase.kind === 'ready' && (
        <SaveToToots draft={take.phase.draft} back={take.phase.back} keep={take.keep} />
      )}

      <PadChooser
        pad={choosing}
        current={choosing === null ? null : (mapping?.[choosing] ?? null)}
        recordings={recordings ?? []}
        onChoose={id => {
          if (choosing !== null) assign(choosing, id)
          setChoosing(null)
        }}
        onClose={() => setChoosing(null)}
      />
    </div>
  )
}
