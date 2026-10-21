import { getCloudflareContext } from '@opennextjs/cloudflare'

import type { Kind } from '@/db/library'

// The audio in R2 (`MEDIA`): `users/{userId}/recordings/{id}.wav` and `users/{userId}/toots/{id}.wav`.
// Keys are built only here, from the session's user id and an id `isItemId` accepted, and a key
// is written once and never overwritten (SERP's data-and-storage standard).

/** This request's bucket: the environment's `MEDIA` binding (wrangler.jsonc). */
export function getMedia(): R2Bucket {
  return getCloudflareContext().env.MEDIA
}

/** Better Auth's ids are letters and digits; anything else could leave the user's prefix. */
const USER_ID = /^[A-Za-z0-9_-]+$/

/** Everything a user has in the bucket. */
export function userPrefix(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('Unexpected user id')
  return `users/${userId}/`
}

/** Where one Recording's or Toot's WAV is kept. */
export function audioKey(userId: string, kind: Kind, id: string): string {
  return `${userPrefix(userId)}${kind}/${id}.wav`
}

/**
 * Writes `bytes` at `key` only if nothing is there yet (`If-None-Match: *`, which R2 checks
 * atomically). Returns the object's size, and whether this call created it.
 */
export async function putAudioOnce(
  media: R2Bucket,
  key: string,
  bytes: Uint8Array
): Promise<{ created: boolean; size: number }> {
  const put = await media.put(key, bytes, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'audio/wav' }
  })
  if (put) return { created: true, size: put.size }
  // Already there: an earlier try of this same upload wrote it, then failed before its row.
  const existing = await media.head(key)
  if (!existing) throw new Error('R2 refused the write but has no object')
  return { created: false, size: existing.size }
}

/** Deletes everything under the user's prefix, a page of up to 1,000 keys at a time. */
export async function deleteUserMedia(media: R2Bucket, userId: string): Promise<void> {
  const prefix = userPrefix(userId)
  for (;;) {
    const page = await media.list({ prefix, limit: 1000 })
    if (page.objects.length === 0) return
    await media.delete(page.objects.map(object => object.key))
  }
}
