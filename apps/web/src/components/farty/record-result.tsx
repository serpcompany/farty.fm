'use client'

import { AudioWaveform, CircleHelp, LockOpen } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress as CoverageBar } from '@/components/ui/progress'
import { startAudioInTap } from '@/lib/audio/context'
import { noteName, pitchClass } from '@/lib/pitch'
import {
  type CoverageChanges,
  coverageFraction,
  coverageSummary,
  type SongRow
} from '@/lib/pitch-coverage'
import { type Recording, songPitch } from '@/lib/recordings'
import { useAccount } from './account-provider'
import { PitchStrip } from './pitch-strip'
import { FlowButton, FlowButtons } from './record-cover'
import { useRecordFlow } from './record-flow-provider'
import { useRecordings } from './recordings-provider'

const route = (path: string) => path.replace(/\/$/, '') || '/'

function useFinishFlow(): (href: string) => void {
  const { closeFlow } = useRecordFlow()
  const router = useRouter()
  const pathname = usePathname()
  const [leaving, setLeaving] = useState<string | null>(null)
  useEffect(() => {
    if (leaving !== null && route(pathname) !== leaving) closeFlow()
  }, [closeFlow, leaving, pathname])
  return href => {
    if (route(href) === route(pathname)) {
      closeFlow()
      return
    }
    setLeaving(route(pathname))
    router.push(href)
  }
}

export function AnalysisFailed({ id }: { id: string }) {
  const { retryAnalysis } = useRecordFlow()
  const finish = useFinishFlow()
  return (
    <>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleHelp />
          </EmptyMedia>
          <EmptyTitle>Saved, but we couldn't find its note</EmptyTitle>
          <EmptyDescription>It's on the Recordings tab as not analyzed.</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={() => finish('/recordings/')}>
            Done
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" onClick={() => void retryAnalysis(id)}>
            Retry
          </FlowButton>
        }
      />
    </>
  )
}

export function Result({
  recording,
  changes,
  trimFailed
}: {
  recording: Recording
  changes: CoverageChanges
  trimFailed?: boolean
}) {
  const { collectedPitchClasses, melodicRecordings } = useRecordings()
  const finish = useFinishFlow()
  const { offerStep } = useAccount()
  const go = (href: string) => offerStep(() => finish(href))
  const pitch = songPitch(recording)

  return (
    <>
      <div className="flex flex-1 flex-col items-center gap-7 overflow-y-auto p-5 text-center">
        {pitch !== null ? (
          <div className="flex w-full flex-col items-center gap-1">
            <p className="font-semibold text-muted-foreground">Your note</p>
            <p className="text-8xl font-bold tracking-tight" data-testid="result-note">
              {noteName(pitch)}
            </p>
            <PitchStrip
              className="w-full pt-3"
              collected={collectedPitchClasses}
              outlined={pitchClass(pitch)}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <AudioWaveform className="size-16 text-muted-foreground" aria-hidden />
            <p className="text-2xl font-bold" data-testid="result-no-note">
              No note
            </p>
            <p className="text-muted-foreground">
              It's saved. Songs leave it out until you give it a note from the Recordings tab.
            </p>
          </div>
        )}
        {trimFailed && (
          <p role="alert" className="text-sm text-destructive" data-testid="result-trim-failed">
            Couldn't save the trim, so it's kept whole. Trim it again from the Recordings tab.
          </p>
        )}
        <Progress changes={changes} hasMelodicRecordings={melodicRecordings.length > 0} />
      </div>
      {changes.unlocked.length > 0 ? (
        <FlowButtons
          secondary={
            <FlowButton variant="secondary" onClick={() => go('/recordings/')}>
              Done
            </FlowButton>
          }
          primary={
            <FlowButton
              variant="primary"
              onClick={() => {
                startAudioInTap()
                go(`/compose/${changes.unlocked[0].id}/`)
              }}
            >
              Try it
            </FlowButton>
          }
        />
      ) : (
        <FlowButtons
          secondary={
            <FlowButton variant="secondary" onClick={() => go('/')}>
              Record another
            </FlowButton>
          }
          primary={
            <FlowButton variant="primary" onClick={() => go('/recordings/')}>
              Done
            </FlowButton>
          }
        />
      )}
    </>
  )
}

function Progress({
  changes,
  hasMelodicRecordings
}: {
  changes: CoverageChanges
  hasMelodicRecordings: boolean
}) {
  const { unlocked, improved, closest } = changes
  const showsClosest =
    unlocked.length === 0 && improved.length === 0 && closest !== null && hasMelodicRecordings
  if (unlocked.length === 0 && improved.length === 0 && !showsClosest) return null
  return (
    <div className="flex w-full flex-col gap-3 text-left" data-testid="result-progress">
      {unlocked.length > 2 ? (
        <Box>
          <Unlocked>You unlocked {unlocked.length} Songs</Unlocked>
          <p className="pt-1 text-muted-foreground">{unlocked.map(s => s.title).join(' · ')}</p>
        </Box>
      ) : (
        unlocked.map(song => (
          <Box key={song.id}>
            <Unlocked>You unlocked {song.title}</Unlocked>
          </Box>
        ))
      )}
      {improved.slice(0, 2).map(row => (
        <CoverageCard key={row.song.id} row={row} />
      ))}
      {showsClosest && closest && <CoverageCard row={closest} />}
    </div>
  )
}

function Box({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/60 p-4" data-testid="result-card">
      {children}
    </div>
  )
}

function Unlocked({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-semibold">
      <LockOpen className="size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function CoverageCard({ row }: { row: SongRow }) {
  return (
    <Box>
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold">{row.song.title}</p>
        <CoverageBar value={coverageFraction(row.coverage) * 100} aria-hidden />
        <p className="text-sm text-muted-foreground">{coverageSummary(row.coverage)}</p>
      </div>
    </Box>
  )
}
