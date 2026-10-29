import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'

import { d1Now } from './d1-clock'
import type { Database } from './database'
import { tootPayments } from './schema'

export type TootPaymentRow = typeof tootPayments.$inferSelect

const whereToot = (userId: string, tootId: string) =>
  and(eq(tootPayments.userId, userId), eq(tootPayments.tootId, tootId))

export async function tootPayment(
  db: Database,
  userId: string,
  tootId: string
): Promise<TootPaymentRow | null> {
  const [row] = await db.select().from(tootPayments).where(whereToot(userId, tootId))
  return row ?? null
}

async function isTootPaid(db: Database, userId: string, tootId: string): Promise<boolean> {
  const rows = await db
    .select({ tootId: tootPayments.tootId })
    .from(tootPayments)
    .where(and(whereToot(userId, tootId), isNotNull(tootPayments.paidAt)))
  return rows.length === 1
}

export async function startTootPayment(
  db: Database,
  userId: string,
  tootId: string,
  songId: string,
  checkoutSessionId: string,
  price: { amount: number; currency: string }
): Promise<void> {
  await db
    .insert(tootPayments)
    .values({
      userId,
      tootId,
      songId,
      checkoutSessionId,
      amount: price.amount,
      currency: price.currency,
      createdAt: sql`${d1Now}`
    })
    .onConflictDoUpdate({
      target: [tootPayments.userId, tootPayments.tootId],
      set: {
        songId,
        checkoutSessionId,
        amount: price.amount,
        currency: price.currency,
        createdAt: sql`${d1Now}`
      },
      setWhere: isNull(tootPayments.paidAt)
    })
}

export async function paidUnsavedToot(
  db: Database,
  userId: string,
  songId: string,
  tootId: string
): Promise<string | null> {
  const [row] = await db
    .select({ tootId: tootPayments.tootId })
    .from(tootPayments)
    .where(
      and(
        eq(tootPayments.userId, userId),
        eq(tootPayments.songId, songId),
        ne(tootPayments.tootId, tootId),
        isNotNull(tootPayments.paidAt),
        isNull(tootPayments.savedAt),
        sql`not exists (select 1 from toots
          where toots.user_id = ${tootPayments.userId} and toots.id = ${tootPayments.tootId})`
      )
    )
    .orderBy(desc(tootPayments.paidAt))
    .limit(1)
  return row?.tootId ?? null
}

export async function markTootPaid(
  db: Database,
  userId: string,
  tootId: string,
  checkoutSessionId: string
): Promise<boolean> {
  await db
    .update(tootPayments)
    .set({ checkoutSessionId, paidAt: sql`${d1Now}` })
    .where(and(whereToot(userId, tootId), isNull(tootPayments.paidAt)))
  return isTootPaid(db, userId, tootId)
}
