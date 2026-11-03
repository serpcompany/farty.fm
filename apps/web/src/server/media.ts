import { getCloudflareContext } from '@opennextjs/cloudflare'

import type { Kind } from '@/db/library'

export function getMedia(): R2Bucket {
  return getCloudflareContext().env.MEDIA
}

const USER_ID = /^[A-Za-z0-9_-]+$/

export function userPrefix(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error('Unexpected user id')
  return `users/${userId}/`
}

export function audioKey(userId: string, kind: Kind, id: string): string {
  return `${userPrefix(userId)}${kind}/${id}.wav`
}

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
  const existing = await media.head(key)
  if (!existing) throw new Error('R2 refused the write but has no object')
  return { created: false, size: existing.size }
}

export async function deleteUserMedia(media: R2Bucket, userId: string): Promise<void> {
  const prefix = userPrefix(userId)
  for (;;) {
    const page = await media.list({ prefix, limit: 1000 })
    if (page.objects.length === 0) return
    await media.delete(page.objects.map(object => object.key))
  }
}
