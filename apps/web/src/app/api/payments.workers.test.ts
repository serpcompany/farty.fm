import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'

import { tootPayment } from '@/db/payments'
import { PAYMENT_LIMITS } from '@/server/toot-payments'
import { extraEnv } from '@/test-support/extra-env'
import { api, deletedAgo, ORIGIN, seed, signUp, T1, testDb } from '@/test-support/library-api'
import {
  checkout,
  paid,
  payDev,
  paymentsHarness,
  save,
  T2,
  T3,
  tootRows
} from '@/test-support/payments-api'
import { TEST_KEY } from '@/test-support/stripe'

vi.mock('@opennextjs/cloudflare', async () =>
  (await import('@/test-support/extra-env')).cloudflareWithExtraEnv()
)

paymentsHarness()

async function signUpAndPayForT1() {
  const a = await signUp('A')
  await checkout(T1, a)
  await payDev(T1, a)
  return a
}

const purgeTootTombstones = (userId: string) =>
  env.DB.prepare('delete from toots where user_id = ?1').bind(userId).run()

describe('on a local run, with the dev checkout', () => {
  it('saves a Toot once it is paid for, and not before', async () => {
    const a = await signUp('A')
    expect(await (await save(T1, a)).json()).toEqual({ error: 'payment_required' })
    expect((await save(T1, a)).status).toBe(402)

    const started = await checkout(T1, a)
    expect(started.status).toBe(200)
    expect(started.headers.get('cache-control')).toBe('private, no-store')
    expect(await started.json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T1}&song=twinkle`
    })
    expect(await paid(T1, a)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)

    const paying = await payDev(T1, a)
    expect(paying.status).toBe(303)
    expect(paying.headers.get('location')).toBe(
      `${ORIGIN}/compose/twinkle/?toot=${T1}&checkout=done`
    )
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
    expect(await (await checkout(T1, a)).json()).toEqual({ paid: true })
  })

  it('pays for one Toot at a time', async () => {
    const a = await signUpAndPayForT1()
    expect((await save(T1, a)).status).toBe(201)
    expect((await save(T2, a)).status).toBe(402)
    expect(await paid(T2, a)).toBe(false)
  })

  it('never lets one user pay for, or save, another’s Toot', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await checkout(T1, a)
    expect((await payDev(T1, b)).status).toBe(404)
    expect(await paid(T1, a)).toBe(false)
    await payDev(T1, a)
    expect(await paid(T1, b)).toBe(false)
    expect((await save(T1, b)).status).toBe(402)
  })

  it('pays only for a checkout it started', async () => {
    const a = await signUp('A')
    expect((await payDev(T1, a)).status).toBe(404)
    expect((await payDev('not-a-toot', a)).status).toBe(400)
    await checkout(T1, a)
    expect((await payDev(T1, a, 'no-such-song')).status).toBe(400)
  })

  it('has no dev checkout off this machine, or with a Stripe key', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    expect((await payDev(T1, { ...a, host: 'farty.example' })).status).toBe(404)
    expect(await (await checkout(T2, { ...a, host: 'farty.example' })).json()).toEqual({
      error: 'payments_unavailable'
    })
    extraEnv.STRIPE_SECRET_KEY = TEST_KEY
    expect((await payDev(T1, a)).status).toBe(404)
    expect(await paid(T1, a)).toBe(false)
  })

  it('refuses a checkout for a bad id, an unknown Song, or another library', async () => {
    const a = await signUp('A')
    expect((await checkout('not-a-toot', a)).status).toBe(404)
    expect(await (await checkout(T1, a, 'no-such-song')).json()).toEqual({
      error: 'invalid_request'
    })
    expect((await checkout(T1, { ...a, library: 'userB' })).status).toBe(409)
    expect((await checkout(T1, {})).status).toBe(401)
  })

  it('saves a paid Toot once: deleted, it can’t be saved again, even once its tombstone is purged', async () => {
    const a = await signUpAndPayForT1()
    expect((await save(T1, a)).status).toBe(201)
    expect((await tootPayment(testDb(), a.id, T1))?.savedAt).toBeInstanceOf(Date)
    expect((await api.delete('toots', T1, a)).status).toBe(204)
    expect((await save(T1, a)).status).toBe(410)

    await purgeTootTombstones(a.id)
    expect(await tootRows(a.id)).toEqual([])
    const again = await save(T1, a)
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({ error: 'deleted' })
    expect(await (await checkout(T1, a)).json()).toEqual({ error: 'deleted' })
    expect(await tootRows(a.id)).toEqual([])
  })

  it('saves a paid Toot once when two saves cross', async () => {
    const a = await signUpAndPayForT1()
    const statuses = (await Promise.all([save(T1, a), save(T1, a)])).map(r => r.status)
    expect(statuses.sort()).toEqual([200, 201])
    expect(await tootRows(a.id)).toEqual([{ id: T1, deleted_at: null }])
  })

  it('offers a paid Toot of the Song that was never saved, rather than a second payment', async () => {
    const a = await signUpAndPayForT1()
    const offered = await checkout(T2, a)
    expect(offered.status).toBe(200)
    expect(await offered.json()).toEqual({ paidToot: T1 })
    expect(await tootPayment(testDb(), a.id, T2)).toBeNull()
    expect(await tootPayment(testDb(), a.id, T1)).toMatchObject({ songId: 'twinkle' })
    expect(await (await checkout(T3, a, 'mary')).json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T3}&song=mary`
    })

    expect((await save(T1, a)).status).toBe(201)
    expect(await (await checkout(T2, a)).json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T2}&song=twinkle`
    })
  })

  it('never offers another user’s paid Toot, or one saved and deleted', async () => {
    const a = await signUpAndPayForT1()
    const b = await signUp('B')
    expect(await (await checkout(T2, b)).json()).toHaveProperty('url')
    expect((await save(T1, a)).status).toBe(201)
    expect((await api.delete('toots', T1, a)).status).toBe(204)
    expect(await (await checkout(T2, a)).json()).toHaveProperty('url')
  })

  it('limits how many checkouts one user starts', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const { max, window } = PAYMENT_LIMITS.checkouts
    for (let i = 0; i < max; i++) expect((await checkout(T1, a)).status).toBe(200)
    const limited = await checkout(T1, a)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
    const retryAfter = Number(limited.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(window)
    expect((await checkout(T2, a)).status).toBe(429)
    expect((await checkout(T1, b)).status).toBe(200)
    await payDev(T1, a)
    expect(await (await checkout(T1, a)).json()).toEqual({ paid: true })
    expect((await save(T1, a)).status).toBe(201)
  })

  it('refuses a deleted Toot, and one past the Toot limit, before anything is paid', async () => {
    const a = await signUp('A')
    await deletedAgo('toots', a.id, T1, 0)
    expect(await (await checkout(T1, a)).json()).toEqual({ error: 'deleted' })

    await seed('toots', a.id, 300)
    const full = await checkout(T2, a)
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'limit_reached' })
    expect(await tootPayment(testDb(), a.id, T2)).toBeNull()
  })
})
