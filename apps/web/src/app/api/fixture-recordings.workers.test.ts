import { afterEach, describe, expect, it, vi } from 'vitest'

import { fixtureRecordingId } from '@/lib/fixture-library'
import { extraEnv } from '@/test-support/extra-env'
import { api, library, R1, signUp, upload } from '@/test-support/library-api'

vi.mock('@opennextjs/cloudflare', async () =>
  (await import('@/test-support/extra-env')).cloudflareWithExtraEnv()
)

const FIXTURE = fixtureRecordingId('090')

async function uploadedAgainAfterDeletes(siteEnv: string | undefined) {
  extraEnv.SITE_ENV = siteEnv
  const a = await signUp('A')
  for (const id of [FIXTURE, R1]) {
    await upload('recordings', id, a.cookie)
    expect((await api.delete('recordings', id, a)).status).toBe(204)
  }
  const fixture = (await upload('recordings', FIXTURE, a.cookie)).status
  const other = (await upload('recordings', R1, a.cookie)).status
  return { a, fixture, other }
}

describe('a deleted Fixture Library Recording', () => {
  afterEach(() => {
    delete extraEnv.SITE_ENV
  })

  it.each([
    ['locally', undefined],
    ['on Staging', 'staging']
  ])('uploads again %s, with its audio, while any other deleted Recording stays deleted', async (_, siteEnv) => {
    const { a, fixture, other } = await uploadedAgainAfterDeletes(siteEnv)
    expect(fixture).toBe(201)
    expect(other).toBe(410)
    const everything = await library(a.cookie)
    expect(everything.recordings.map(r => r.id)).toEqual([FIXTURE])
    expect(everything.deleted.recordings).toEqual([R1])
    expect((await api.audio('recordings', FIXTURE, a)).status).toBe(200)
  })

  it('stays deleted on Production, like every other Recording', async () => {
    const { fixture, other } = await uploadedAgainAfterDeletes('production')
    expect(fixture).toBe(410)
    expect(other).toBe(410)
  })
})
