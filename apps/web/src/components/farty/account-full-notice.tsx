'use client'

import { useEffect, useState } from 'react'
import { onLibraryChanged } from '@/lib/library-changes'
import { waitingForRoom } from '@/lib/library-sync'
import { type Kind, onOutboxChanged } from '@/lib/outbox'

const nouns: Record<Kind, string> = { recordings: 'Recording', toots: 'Toot' }

function useWaitingForRoom(kind: Kind): number {
  const [waiting, setWaiting] = useState(0)
  useEffect(() => {
    let current = true
    const read = () => {
      waitingForRoom(kind).then(
        count => {
          if (current) setWaiting(count)
        },
        () => {}
      )
    }
    read()
    const stops = [onOutboxChanged(read), onLibraryChanged(read)]
    return () => {
      current = false
      for (const stop of stops) stop()
    }
  }, [kind])
  return waiting
}

export function AccountFullNotice({ kind }: { kind: Kind }) {
  const waiting = useWaitingForRoom(kind)
  if (waiting === 0) return null
  const items = waiting === 1 ? `1 ${nouns[kind]} is` : `${waiting} ${nouns[kind]}s are`
  return (
    <p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="account-full">
      Your account is full, so {items} only on this device. Delete some to make room.
    </p>
  )
}
