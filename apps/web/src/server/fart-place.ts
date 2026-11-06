import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { type RecordedPlace, recordedPlaceOf } from '@/lib/fart-place'

/**
 * How old a take can be when it uploads and still be said to come from where it uploaded from. A
 * take uploads once it's saved, so an older one waited for a connection, maybe until its owner got
 * home, and saying so would name their home as where a fart made elsewhere was made.
 */
const FRESH_MS = 60 * 60 * 1000

/**
 * What to keep of where a Recording made at `createdAt` is being uploaded from (#444, ADR 0020).
 * Nothing for a take older than an hour, since it may have been made anywhere. `insertRecording`
 * keeps it only with the owner's switch on.
 */
export function placeOfUpload(createdAt: number): RecordedPlace | null {
  if (Math.abs(Date.now() - createdAt) > FRESH_MS) return null
  return recordedPlaceOf(getCloudflareContext().cf)
}
