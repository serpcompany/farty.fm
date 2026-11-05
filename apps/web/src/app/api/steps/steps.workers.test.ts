import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stepCounts } from '@/db/schema'
import { addStepCount, countStep } from '@/db/step-counts'
import { BROWSER_STEPS } from '@/lib/telemetry/step-names'
import { ORIGIN, testDb } from '@/test-support/library-api'

import { POST } from './route'

// The funnel's steps (#405) in workerd, with a real D1: a row per day and step, holding only those
// and the count, from this site only and only for a browser's steps.

const send = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new Request(`${ORIGIN}/api/steps/`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
      body
    })
  )

const counts = () => testDb().select().from(stepCounts)

beforeEach(async () => {
  await testDb().delete(stepCounts)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/steps/', () => {
  it('adds to today’s count of the step, no-store, keeping only the day, step and count', async () => {
    const response = await send(JSON.stringify({ step: 'open' }), {
      'cf-connecting-ip': '203.0.113.7',
      cookie: 'session=abc'
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await send(JSON.stringify({ step: 'open' }))
    await send(JSON.stringify({ step: 'mic-allowed' }))

    const today = new Date().toISOString().slice(0, 10)
    expect(await counts()).toEqual(
      expect.arrayContaining([
        { day: today, step: 'open', count: 2 },
        { day: today, step: 'mic-allowed', count: 1 }
      ])
    )
    expect(await counts()).toHaveLength(2)
  })

  it.each(BROWSER_STEPS)('takes %s', async step => {
    expect((await send(JSON.stringify({ step }))).status).toBe(204)
  })

  it.each<[string, () => Promise<Response>, number, string]>([
    [
      'another origin',
      () => send('{"step":"open"}', { origin: 'https://evil.example' }),
      403,
      'cross_origin'
    ],
    [
      'anything but JSON',
      () => send('{"step":"open"}', { 'content-type': 'text/plain' }),
      415,
      'not_json'
    ],
    ['a body over its limit', () => send(`{"step":"${'x'.repeat(200)}"}`), 413, 'too_large'],
    ['an unknown step', () => send('{"step":"nope"}'), 400, 'bad_step'],
    ['the server’s paid step', () => send('{"step":"paid"}'), 400, 'bad_step'],
    ['the server’s checkout step', () => send('{"step":"checkout-started"}'), 400, 'bad_step'],
    ['an extra field', () => send('{"step":"open","id":"abc"}'), 400, 'bad_step'],
    ['a body that isn’t JSON', () => send('{"step":'), 400, 'bad_step']
  ])('refuses %s, and counts nothing', async (_, request, status, error) => {
    const response = await request()
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
    expect(await counts()).toEqual([])
  })
})

describe('countStep', () => {
  it('counts a server step, and never throws when it can’t', async () => {
    await countStep(testDb(), 'paid')
    await addStepCount(testDb(), 'paid')
    expect((await counts()).map(row => [row.step, row.count])).toEqual([['paid', 2]])

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = {
      insert: () => {
        throw new Error('D1 is down')
      }
    } as unknown as Parameters<typeof countStep>[0]
    await expect(countStep(broken, 'paid')).resolves.toBeUndefined()
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      event: 'step_count_failed',
      step: 'paid'
    })
  })
})
