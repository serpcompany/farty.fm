import { like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { Kind } from '@/db/library'
import { rateLimit, shareReports } from '@/db/schema'
import { api, ORIGIN, R1, T1, testDb } from '@/test-support/library-api'
import {
  linkParts,
  saveToot,
  share,
  sharer,
  shareUrl,
  slots,
  slotsLike,
  tootSharer
} from '@/test-support/sharing-api'

const reportFiveTimes = async (url: string) => {
  for (let i = 0; i < 5; i++) {
    expect((await share.report(url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
  }
}

const reportRows = () => testDb().select().from(shareReports)

const KINDS: { name: string; kind: Kind; id: string; sharer: typeof sharer }[] = [
  { name: 'Recording', kind: 'recordings', id: R1, sharer },
  { name: 'Toot', kind: 'toots', id: T1, sharer: tootSharer }
]

describe.each(KINDS)('Reporting a shared $name', ({ kind, id, sharer: shareOne }) => {
  it('keeps a row naming the share and the item, not the reporter', async () => {
    const alice = await shareOne('alice')
    expect((await share.report(alice.url)).status).toBe(204)
    expect(await reportRows()).toEqual([
      expect.objectContaining({
        shareId: linkParts(alice.url).id,
        userId: alice.id,
        kind,
        itemId: id
      })
    ])
    expect(await slots(`share_report_item|${alice.id}|${kind}|${id}`)).toBe(1)
  })

  it('is refused from another site, or with no origin', async () => {
    const alice = await shareOne('alice')
    expect((await share.report(alice.url, 'https://evil.example')).status).toBe(403)
    expect((await share.report(alice.url, null)).status).toBe(403)
    expect(await reportRows()).toEqual([])
  })

  it('keeps a few reports a day per item, and answers 429 past them', async () => {
    const alice = await shareOne('alice')
    await reportFiveTimes(alice.url)
    const refused = await share.report(alice.url, ORIGIN, '203.0.113.9')
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: 'too_many_reports' })
    expect(await reportRows()).toHaveLength(5)
    expect(await slots('share_report')).toBe(5)
    expect(await slotsLike('share-reporter|%')).toEqual([1, 1, 1, 1, 1])
  })

  it("doesn't start an item's reports over when it's shared again under a new link", async () => {
    const alice = await shareOne('alice')
    await reportFiveTimes(alice.url)
    expect((await share.stop(id, alice, kind)).status).toBe(204)
    const again = await shareUrl(id, alice, kind)
    expect(again).not.toBe(alice.url)
    expect((await share.report(again, ORIGIN, '198.51.100.1')).status).toBe(429)
    expect(await reportRows()).toHaveLength(5)
    expect(await slots('share_report')).toBe(5)
  })
})

async function tenReportsBeforeCarol(ip: string | null) {
  const alice = await sharer('alice')
  const bob = await sharer('bob')
  const carol = await sharer('carol')
  for (const link of [alice, bob]) {
    for (let i = 0; i < 5; i++) {
      expect((await share.report(link.url, ORIGIN, ip)).status).toBe(204)
    }
  }
  return carol
}

describe('Reporting a shared Recording', () => {
  it('keeps a few reports an hour per reporter, so one client cannot spend the site', async () => {
    const carol = await tenReportsBeforeCarol('203.0.113.1')
    expect((await share.report(carol.url)).status).toBe(429)
    expect(await slotsLike('share_report_item|usercarol|%')).toEqual([])
    expect(await slots('share_report')).toBe(10)
    expect((await share.report(carol.url, ORIGIN, '198.51.100.7')).status).toBe(204)
    const keys = (await testDb().select({ key: rateLimit.key }).from(rateLimit)).map(r => r.key)
    expect(keys.join(' ')).not.toMatch(/203\.0\.113|198\.51\.100/)
  })

  it("answers 429 when the site has had too many, and spends no link's or reporter's slot", async () => {
    const alice = await sharer('alice')
    const now = Date.now()
    await testDb()
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: 'share_report',
        count: 300,
        lastRequest: now + 60 * 60 * 1000
      })
    expect((await share.report(alice.url)).status).toBe(429)
    expect(await reportRows()).toEqual([])
    expect(await slotsLike('share_report_item|%')).toEqual([])
    expect(await slotsLike('share-reporter|%')).toEqual([])

    await testDb()
      .update(rateLimit)
      .set({ lastRequest: now - 1 })
    await reportFiveTimes(alice.url)
    expect(await reportRows()).toHaveLength(5)
  })

  it('puts every report with no client address in one shared bucket, still capped', async () => {
    const carol = await tenReportsBeforeCarol(null)
    expect((await share.report(carol.url, ORIGIN, null)).status).toBe(429)
    expect(await reportRows()).toHaveLength(10)
    const reporters = await testDb()
      .select({ key: rateLimit.key, count: rateLimit.count })
      .from(rateLimit)
      .where(like(rateLimit.key, 'share-reporter|%'))
    expect(reporters).toEqual([
      { key: expect.stringMatching(/^share-reporter\|[0-9a-f]+$/), count: 10 }
    ])
    expect((await share.report(carol.url)).status).toBe(204)
  })

  it('goes with the account', async () => {
    const alice = await sharer('alice')
    await share.report(alice.url)
    await api.deleteAccount(alice)
    expect(await reportRows()).toEqual([])
  })
})

describe('Reporting a shared Toot', () => {
  it("spends the same reporter's and site's slots as a Recording's report", async () => {
    const alice = await sharer('alice')
    await saveToot(T1, alice)
    const tootUrl = await shareUrl(T1, alice, 'toots')
    const bob = await tootSharer('bob')
    for (const url of [alice.url, tootUrl]) {
      for (let i = 0; i < 5; i++) expect((await share.report(url)).status).toBe(204)
    }
    expect((await share.report(bob.url)).status).toBe(429)
    expect(await slots('share_report')).toBe(10)
    expect(await slotsLike('share-reporter|%')).toEqual([10])
    expect((await share.report(bob.url, ORIGIN, '198.51.100.7')).status).toBe(204)
  })
})
