import type { Database } from '@/db/database'
import type { Kind } from '@/db/library'
import { addReport, type ShareRow } from '@/db/sharing'
import { servedOrigin } from '@/lib/site'

import { apiError, notFound } from './http'
import type { Stores } from './library'
import { consumeSlots, reporterLimitKey, requestClient, type SlotRule } from './rate-limits'
import { findSharedRecording, findSharedToot } from './sharing'

const REPORT_LIMITS = {
  perReporter: { window: 60 * 60, max: 10 },
  perItem: { window: 24 * 60 * 60, max: 5 },
  siteWide: { window: 60 * 60, max: 300 }
} satisfies Record<string, SlotRule>

const SITE_REPORTS_KEY = 'share_report'

const itemReportsKey = (share: { userId: string; kind: Kind; itemId: string }) =>
  `share_report_item|${share.userId}|${share.kind}|${share.itemId}`

export const crossOriginReport = (request: Request) =>
  request.headers.get('origin') === servedOrigin(request) ? null : apiError(403, 'cross_origin')

export async function spendReportSlots(
  db: Database,
  request: Request,
  secret: string,
  itemKey: string,
  now: number
): Promise<boolean> {
  return consumeSlots(
    db.$client,
    [
      {
        key: await reporterLimitKey(secret, requestClient(request)),
        rule: REPORT_LIMITS.perReporter
      },
      { key: itemKey, rule: REPORT_LIMITS.perItem },
      { key: SITE_REPORTS_KEY, rule: REPORT_LIMITS.siteWide }
    ],
    now
  )
}

export async function reportShare(
  kind: Kind,
  { db }: Stores,
  request: Request,
  handle: string,
  shareId: string,
  secret: string
): Promise<Response> {
  const crossOrigin = crossOriginReport(request)
  if (crossOrigin) return crossOrigin
  const share = await liveShare(kind, db, handle, shareId)
  if (!share) return notFound()
  const now = Date.now()
  if (!(await spendReportSlots(db, request, secret, itemReportsKey(share), now))) {
    return apiError(429, 'too_many_reports')
  }
  await addReport(db, share, crypto.randomUUID(), new Date(now))
  console.warn(JSON.stringify({ event: 'share_reported', shareId, kind }))
  return new Response(null, { status: 204 })
}

async function liveShare(
  kind: Kind,
  db: Database,
  handle: string,
  shareId: string
): Promise<ShareRow | null> {
  const shared =
    kind === 'toots'
      ? await findSharedToot(db, handle, shareId)
      : await findSharedRecording(db, handle, shareId)
  return shared?.row.share ?? null
}
