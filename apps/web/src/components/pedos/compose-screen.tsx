'use client'

import { Music2 } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { usePedos } from './pedos-provider'

/**
 * The Compose tab, for now: the iPhone app's `ComposeTab` with its empty state and without its
 * Songs. #119 brings the Song Catalog with each Song's Pitch Coverage.
 */
export function ComposeScreen() {
  const pedos = usePedos()

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Compose</h1>
      {pedos.recordings !== null && pedos.melodicRecordings.length === 0 && (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Music2 />
            </EmptyMedia>
            <EmptyTitle>No Melodic Recordings yet</EmptyTitle>
            <EmptyDescription>
              Record a few farts with a clear note to start unlocking Songs.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
