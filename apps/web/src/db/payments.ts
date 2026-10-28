import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

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

export async function isTootPaid(db: Database, userId: string, tootId: string): Promise<boolean> {
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
  checkoutSessionId: string,
  price: { amount: number; currency: string }
): Promise<void> {
  await db
    .insert(tootPayments)
    .values({
      userId,
      tootId,
      checkoutSessionId,
      amount: price.amount,
      currency: price.currency,
      createdAt: sql`${d1Now}`
    })
    .onConflictDoUpdate({
      target: [tootPayments.userId, tootPayments.tootId],
      set: {
        checkoutSessionId,
        amount: price.amount,
        currency: price.currency,
        createdAt: sql`${d1Now}`
      },
      setWhere: isNull(tootPayments.paidAt)
    })
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
