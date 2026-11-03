'use client'

import { type RefObject, useCallback, useRef, useState } from 'react'
import { analyze } from '@/lib/analysis/client'
import { type RescanResult, rescan } from '@/lib/analysis-upgrade'
import type { Recording } from '@/lib/recordings'

export type Rescanning = { recordingId: string; done: number; total: number }

export function useRescan(
  latest: RefObject<Recording[] | null>,
  replace: (updated: Recording) => void
) {
  const [rescanning, setRescanning] = useState<Rescanning | null>(null)
  const [rescanned, setRescanned] = useState<RescanResult | null>(null)
  const running = useRef<Promise<RescanResult> | null>(null)

  const runRescan = useCallback(
    (targets: (all: Recording[]) => Recording[]): Promise<RescanResult> => {
      if (running.current) return running.current
      setRescanned(null)
      const run = rescan(
        targets(latest.current ?? []),
        analyze,
        replace,
        (recording, done, total) => setRescanning({ recordingId: recording.id, done, total })
      )
        .then(result => {
          setRescanned(result)
          return result
        })
        .finally(() => {
          running.current = null
          setRescanning(null)
        })
      running.current = run
      return run
    },
    [latest, replace]
  )

  const rescanRecording = useCallback(
    (id: string) => runRescan(all => all.filter(r => r.id === id)),
    [runRescan]
  )
  const rescanAll = useCallback(() => runRescan(all => all), [runRescan])

  return { rescanning, rescanned, rescanRecording, rescanAll }
}
