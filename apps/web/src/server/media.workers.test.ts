import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { audioKey, deleteUserMedia, putAudioOnce, userPrefix } from './media'

// R2 in workerd: the keys, and a key written once and never overwritten.

const bytes = (...values: number[]) => new Uint8Array(values)

describe('putAudioOnce', () => {
  it('writes a new key, and leaves an existing one as it was', async () => {
    const key = audioKey('userA', 'recordings', '11111111-1111-4111-8111-111111111111')

    const first = await putAudioOnce(env.MEDIA, key, bytes(1, 2, 3))
    const second = await putAudioOnce(env.MEDIA, key, bytes(9, 9, 9, 9))

    expect(first).toEqual({ created: true, size: 3 })
    expect(second).toEqual({ created: false, size: 3 })
    const stored = await env.MEDIA.get(key)
    expect(new Uint8Array(await (stored as R2ObjectBody).arrayBuffer())).toEqual(bytes(1, 2, 3))
    expect(stored?.httpMetadata?.contentType).toBe('audio/wav')
  })

  it('lets only one of two writes at once create the key', async () => {
    const key = audioKey('userA', 'toots', '33333333-3333-4333-8333-333333333333')

    const results = await Promise.all([
      putAudioOnce(env.MEDIA, key, bytes(1)),
      putAudioOnce(env.MEDIA, key, bytes(2))
    ])

    expect(results.map(result => result.created).sort()).toEqual([false, true])
  })
})

describe('deleteUserMedia', () => {
  it('deletes every key under the user’s prefix, past one page of the listing', async () => {
    // More than one page of R2's listing (1,000 keys). Writing them takes a few seconds while
    // other test files run, hence the longer timeout.
    await Promise.all(
      Array.from({ length: 1001 }, (_, i) =>
        env.MEDIA.put(`users/userA/recordings/${i}.wav`, bytes(i % 256))
      )
    )
    await env.MEDIA.put('users/userAB/recordings/1.wav', bytes(1))

    await deleteUserMedia(env.MEDIA, 'userA')

    const left = await env.MEDIA.list({ prefix: 'users/' })
    expect(left.objects.map(object => object.key)).toEqual(['users/userAB/recordings/1.wav'])
  }, 30_000)
})

describe('userPrefix', () => {
  it('keeps every key under the user’s own prefix', () => {
    expect(audioKey('userA', 'toots', 'x')).toBe('users/userA/toots/x.wav')
    for (const id of ['', '../userB', 'a/b', 'a.b']) {
      expect(() => userPrefix(id)).toThrow()
    }
  })
})
