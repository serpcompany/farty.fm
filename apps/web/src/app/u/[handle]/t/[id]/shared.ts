import 'server-only'

import { cache } from 'react'
import { songs } from '@/lib/catalog/songs.generated'
import { formattedTootLength, PAD_TOOT_TITLE } from '@/lib/toot'
import { requestStores } from '@/server/library'
import { pageOrigin } from '@/server/link-preview'
import { findSharedToot, sharedTootKey, sharedTootLevels } from '@/server/sharing'

/** What a shared Toot's page, and its link image, show of it: nothing private. */
export type SharedTootView = {
  handle: string
  shareId: string
  title: string
  /**
   * The Song it plays, "Twinkle, Twinkle, Little Star", or "Sound Pad" for a Sound Pad Toot, as
   * its row says. Null for a Song that isn't in Farty any more.
   */
  song: string | null
  /** Whether it plays a catalog Song, not the Sound Pad. */
  isSong: boolean
  /** "0:18", as its row shows it. */
  length: string
  seconds: number
  /** The loudness bars of its saved audio, each 0…1. */
  levels: number[]
}

/**
 * The saved Toot shared at `/u/<handle>/t/<id>/`, or null when that link doesn't work: never
 * shared, stopped, taken down, never saved, or its Toot or account deleted. Once per request.
 */
export const sharedTootView = cache(
  async (handle: string, id: string): Promise<SharedTootView | null> => {
    const { db, media } = requestStores()
    const shared = await findSharedToot(db, handle, id)
    if (!shared) return null
    const song =
      shared.songId === null
        ? PAD_TOOT_TITLE
        : (songs.find(s => s.id === shared.songId)?.title ?? null)
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

/** What the link's description says: "Twinkle, Twinkle, Little Star, played on farts. …" */
export function tootDescription(view: SharedTootView): string {
  return view.isSong && view.song
    ? `${view.song}, played on farts. Tap to play.`
    : 'A fart song on Farty. Tap to play.'
}
