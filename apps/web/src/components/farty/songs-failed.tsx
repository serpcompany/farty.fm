'use client'

import { Button } from '@/components/ui/button'
import { useSongCatalog } from './song-catalog-provider'

export function SongsFailed({ className }: { className: string }) {
  const { reloadSongs } = useSongCatalog()
  return (
    <div className={className}>
      <p className="text-muted-foreground">Couldn't load the Songs.</p>
      <Button variant="outline" className="h-11 px-5 text-base" onClick={reloadSongs}>
        Try again
      </Button>
    </div>
  )
}
