import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Database } from '@/db/database'
import { showsFartPlaces } from '@/db/sharing'
import { type RecordedPlace, recordedPlaceOf } from '@/lib/fart-place'

/** How old a take can be when it uploads and still be said to come from where it uploaded from. */
const FRESH_MS = 24 * 60 * 60 * 1000

/**
 * What to keep of where a Recording made at `createdAt` is being uploaded from (#444, ADR 0020).
 * Nothing for a take older than a day, since it may have been made anywhere since, nor with the
 * owner's switch off.
 */
export async function placeOfUpload(
  db: Database,
  userId: string,
  createdAt: number
): Promise<RecordedPlace | null> {
  if (Math.abs(Date.now() - createdAt) > FRESH_MS) return null
  const place = recordedPlaceOf(getCloudflareContext().cf)
  return place && (await showsFartPlaces(db, userId)) ? place : null
}
