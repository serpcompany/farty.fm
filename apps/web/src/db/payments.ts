import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import type { Database } from './database'
import { tootPayments } from './schema'

// A user's Toot payments in D1 (ADR 0010). As in `library.ts`, every query takes the user's id and
// filters on it.

export type TootPaymentRow = typeof tootPayments.$inferSelect

const d1Now = sql<number>`cast(unixepoch('subsec') * 1000 as integer)`

const whereToot = (userId: string, tootId: string) =>
  and(eq(tootPayments.userId, userId), eq(tootPayments.tootId, tootId))

/** The Toot's payment, paid or not, or null when none was started. */
export async function tootPayment(
  db: Database,
  userId: string,
  tootId: string
): Promise<TootPaymentRow | null> {
  const [row] = await db.select().from(tootPayments).where(whereToot(userId, tootId))
  return row ?? null
}

/** Whether the Toot is paid for. */
export async function isTootPaid(db: Database, userId: string, tootId: string): Promise<boolean> {
  const rows = await db
    .select({ tootId: tootPayments.tootId })
    .from(tootPayments)
    .where(and(whereToot(userId, tootId), isNotNull(tootPayments.paidAt)))
  return rows.length === 1
}

/**
 * Records `checkoutSessionId` as the Toot's latest Checkout Session. A paid Toot keeps its row as
 * it is.
 */
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

/**
 * Marks the Toot paid by `checkoutSessionId`, once. Only a Toot whose payment was started here
 * (`startTootPayment`) can be: a user deleted since has no row. True when it is paid now.
 */
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
