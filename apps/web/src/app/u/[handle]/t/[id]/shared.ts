import 'server-only'

import { cache } from 'react'
import { formattedTootLength } from '@/lib/toot'
import { requestStores } from '@/server/library'
import { pageOrigin } from '@/server/link-preview'
import { sharedTootLevels } from '@/server/shared-audio'
import { findSharedToot, sharedTootKey, tootSongTitle } from '@/server/sharing'

type SharedTootView = {
  handle: string
  shareId: string
  title: string
  song: string | null
  isSong: boolean
  length: string
  seconds: number
  levels: number[]
}

export const sharedTootView = cache(
  async (handle: string, id: string): Promise<SharedTootView | null> => {
    const { db, media } = requestStores()
    const shared = await findSharedToot(db, handle, id)
    if (!shared) return null
    const song = tootSongTitle(shared.songId)
    const origin = (await pageOrigin()) ?? 'http://localhost'
    return {
      handle: shared.handle,
      shareId: shared.shareId,
      title: shared.title,
      song,
      isSong: shared.songId !== null,
      length: formattedTootLength(shared.seconds),
      seconds: shared.seconds,
      levels: await sharedTootLevels(media, sharedTootKey(shared), origin)
    }
  }
)

export function tootDescription(view: SharedTootView): string {
  return view.isSong && view.song
    ? `${view.song}, played on farts. Tap to play.`
    : 'A fart song on Farty. Tap to play.'
}
