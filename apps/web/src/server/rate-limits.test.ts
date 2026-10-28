import { describe, expect, it } from 'vitest'

import {
  answer,
  get,
  SECRET,
  type Sent,
  STAGING,
  sendCode,
  signInHarness,
  siteLimitLines,
  trySignIn
} from '@/test-support/sign-in'

import { GET_SESSION_ENDPOINT, SEND_CODE_ENDPOINT, SIGN_IN_ENDPOINT } from './auth-endpoints'
import { serveAuthRequest } from './auth-request'
import { clientLimitKey, consumeSlot, SITE_CODES_KEY } from './rate-limits'

const { db, local, staging, mailCount, signIn, rows } = signInHarness()

const insertSlot = 'INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, ?, ?)'

describe('rate limits per client', () => {
  it('hold code requests at 10 per 10 minutes per client', async () => {
    for (let n = 1; n <= 10; n++) {
      expect((await sendCode(local(), `fan${n}@example.com`)).status).toBe(200)
    }
    const held = await sendCode(local(), 'one-more@example.com')
    expect(held.status).toBe(429)
    expect(Number(held.headers.get('x-retry-after'))).toBeGreaterThan(9 * 60)
    expect(await mailCount('one-more@example.com')).toBe(0)
    const elsewhere = await sendCode(local(), 'one-more@example.com', { ip: '203.0.113.9' })
    expect(elsewhere.status).toBe(200)
    const key = await clientLimitKey(SECRET, `203.0.113.1|${SEND_CODE_ENDPOINT}`)
    expect(await rows('SELECT count FROM rate_limit WHERE key = ?', key)).toEqual([{ count: 10 }])
  })

  it('hold sign-in guesses at 10 a minute per client', async () => {
    for (let n = 1; n <= 10; n++) {
      expect((await trySignIn(local(), `fan${n}@example.com`, '123456')).status).toBe(400)
    }
    expect((await trySignIn(local(), 'fan@example.com', '123456')).status).toBe(429)
  })

  it('hold sign-in guesses at 60 an hour per client', async () => {
    const minute = await clientLimitKey(SECRET, `203.0.113.1|${SIGN_IN_ENDPOINT}`)
    for (let n = 1; n <= 60; n++) {
      expect((await trySignIn(local(), `fan${n}@example.com`, '123456')).status).toBe(400)
      if (n % 10 === 0)
        await db().prepare('DELETE FROM rate_limit WHERE key = ?').bind(minute).run()
    }
    const held = await trySignIn(local(), 'fan@example.com', '123456')
    expect(held.status).toBe(429)
    expect(Number(held.headers.get('x-retry-after'))).toBeGreaterThan(59 * 60)
    const elsewhere = await trySignIn(local(), 'fan@example.com', '123456', { ip: '203.0.113.9' })
    expect(elsewhere.status).toBe(400)
  })

  it('know a client only by cf-connecting-ip, never X-Forwarded-For', async () => {
    for (let n = 1; n <= 10; n++) {
      const spoofed = { headers: { 'x-forwarded-for': `192.0.2.${n}` } }
      expect((await sendCode(local(), `fan${n}@example.com`, spoofed)).status).toBe(200)
    }
    const held = { headers: { 'x-forwarded-for': '192.0.2.99' } }
    expect((await sendCode(local(), 'fan@example.com', held)).status).toBe(429)
  })

  it('count an IPv6 /64 as one client', async () => {
    for (let n = 1; n <= 10; n++) {
      const ip = `2001:db8:1:2::${n.toString(16)}`
      expect((await sendCode(local(), `fan${n}@example.com`, { ip })).status).toBe(200)
    }
    expect(
      (await sendCode(local(), 'fan@example.com', { ip: '2001:db8:1:2:ffff::1' })).status
    ).toBe(429)
    expect((await sendCode(local(), 'fan@example.com', { ip: '2001:db8:1:3::1' })).status).toBe(200)
  })

  it('never hold reading the session', async () => {
    for (let n = 0; n < 120; n++) {
      expect((await serveAuthRequest(get(GET_SESSION_ENDPOINT), local())).status).toBe(200)
    }
    expect(await rows('SELECT key FROM rate_limit')).toEqual([])
  })
})

describe('code limits', () => {
  it('send an email 5 codes an hour from one client, so one client can’t spend them all', async () => {
    for (let n = 1; n <= 7; n++) {
      const response = await sendCode(local(), 'member@example.com', { ip: '198.51.100.1' })
      expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
    }
    expect(await mailCount('member@example.com')).toBe(5)
    await sendCode(local(), 'member@example.com', { ip: '198.51.100.2' })
    expect(await mailCount('member@example.com')).toBe(6)
  })

  it('send an email 20 codes an hour from every client together', async () => {
    for (let n = 1; n <= 25; n++) {
      const response = await sendCode(local(), 'fan@example.com', { ip: `198.51.100.${n}` })
      expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
    }
    expect(await mailCount('fan@example.com')).toBe(20)
  })

  it('spend per email and client, then per email, then site-wide, which counts only codes that go out', async () => {
    const sent: Sent = []
    const env = staging(sent)
    const ask = async (email: string, client: number, times = 1) => {
      for (let n = 1; n <= times; n++) {
        const response = await sendCode(env, email, { base: STAGING, ip: `198.51.100.${client}` })
        expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
      }
    }
    await ask('member@example.com', 1, 10)
    expect(sent).toHaveLength(5)
    for (const client of [2, 3, 4]) await ask('member@example.com', client, 5)
    expect(sent).toHaveLength(20)
    await ask('member@example.com', 5)
    await ask('other@example.com', 6)
    expect(sent).toHaveLength(20)
    expect(await rows('SELECT count FROM rate_limit WHERE key = ?', SITE_CODES_KEY)).toEqual([
      { count: 20 }
    ])
    expect(siteLimitLines()).toEqual([])
  })

  it('send 300 code emails an hour across the site, and log each request that holds', async () => {
    const windowEnds = Date.now() + 30 * 60_000
    await db().prepare(insertSlot).bind('site', SITE_CODES_KEY, 299, windowEnds).run()
    expect((await sendCode(local(), 'fan1@example.com')).status).toBe(200)
    expect(siteLimitLines()).toEqual([])
    const held = await sendCode(local(), 'fan2@example.com', { ip: '203.0.113.9' })
    expect(await answer(held)).toEqual({ status: 200, body: { success: true } })
    expect(await mailCount('fan1@example.com')).toBe(1)
    expect(await mailCount('fan2@example.com')).toBe(0)
    const lines = siteLimitLines()
    expect(lines).toHaveLength(1)
    const fields = JSON.parse(lines[0].slice('auth_site_code_limit '.length))
    expect(fields).toEqual({ max: 300, windowSeconds: 3600, retryAfterSeconds: expect.any(Number) })
    expect(fields.retryAfterSeconds).toBeGreaterThan(29 * 60)
    expect(fields.retryAfterSeconds).toBeLessThanOrEqual(30 * 60)
    expect(lines[0]).not.toMatch(/fan|example|203\.0\.113|[0-9a-f]{64}/i)
  })
})

describe('the rate_limit table', () => {
  it('finds each row a spend reads or deletes through an index, never by reading the table', async () => {
    const prepared: string[] = []
    const recording = {
      prepare(sql: string) {
        prepared.push(sql)
        return db().prepare(sql)
      },
      batch: (statements: D1PreparedStatement[]) => db().batch(statements)
    } as unknown as D1Database
    expect((await consumeSlot(recording, 'x', Date.now(), { window: 60, max: 1 })).allowed).toBe(
      true
    )
    const plans = await Promise.all(
      prepared.map(async sql => {
        const parameters = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map(([, n]) => Number(n)))
        const plan = await rows<{ detail: string }>(
          `EXPLAIN QUERY PLAN ${sql}`,
          ...Array(parameters).fill(0)
        )
        return plan.map(step => step.detail)
      })
    )
    expect(prepared[0]).toMatch(/^DELETE FROM rate_limit WHERE last_request <= \?1$/)
    expect(plans[0]).toEqual([expect.stringMatching(/ USING .*INDEX rate_limit_last_request_idx /)])
    expect(plans.flat().filter(step => /\bSCAN rate_limit\b/.test(step))).toEqual([])
  })

  it('keeps no email or IP address in its keys', async () => {
    await signIn('Fan@Example.com', { ip: '203.0.113.77' })
    await signIn('fan@example.com', { ip: '2001:db8:77::1' })
    const keys = (await rows<{ key: string }>('SELECT key FROM rate_limit')).map(row => row.key)
    expect(keys.length).toBeGreaterThanOrEqual(8)
    for (const key of keys) {
      expect(key).toMatch(
        /^(client|email|email-client|sign-in-client)\|[0-9a-f]{64}$|^site\|send-code$/
      )
    }
    expect(keys.join(' ')).not.toMatch(/203|2001|db8|fan|example/i)
  })

  it('counts each window from its first request, and refuses with the time left', async () => {
    const rule = { window: 60, max: 2 }
    const start = 1_000_000
    const slot = async (at: number) => (await consumeSlot(db(), 'x', at, rule)).allowed
    expect([await slot(start), await slot(start + 1)]).toEqual([true, true])
    expect(await consumeSlot(db(), 'x', start + 2, rule)).toEqual({
      allowed: false,
      retryAfter: 60
    })
    expect(await slot(start + 59_999)).toBe(false)
    expect([await slot(start + 60_000), await slot(start + 60_001)]).toEqual([true, true])
    expect(await slot(start + 60_002)).toBe(false)
  })

  it('deletes every row whose window has ended, on any request', async () => {
    await db().batch([
      db()
        .prepare(insertSlot)
        .bind('a', 'ended', 1, Date.now() - 1),
      db()
        .prepare(insertSlot)
        .bind('b', 'live', 1, Date.now() + 60_000)
    ])
    expect((await sendCode(local(), 'fan@example.com')).status).toBe(200)
    const keys = (await rows<{ key: string }>('SELECT key FROM rate_limit')).map(row => row.key)
    expect(keys).toContain('live')
    expect(keys).not.toContain('ended')
  })
})
