import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'

import type { Database } from './database'
import { fullAccess, tootPayments } from './schema'
import { countStep } from './step-counts'

// An account's Full Access in D1 (ADR 0022): its purchase, and the Toot payments from before it. As
// in `library.ts`, every query takes the user's id and filters on it, but for the refund that only
// Stripe's payment id names.

export type FullAccessRow = typeof fullAccess.$inferSelect
export type TootPaymentRow = typeof tootPayments.$inferSelect

const d1Now = sql<number>`cast(unixepoch('subsec') * 1000 as integer)`

const whereToot = (userId: string, tootId: string) =>
  and(eq(tootPayments.userId, userId), eq(tootPayments.tootId, tootId))

/**
 * Whether the account has Full Access: it bought it, or paid for a Toot before it could, and that
 * payment wasn't refunded.
 */
export async function hasFullAccess(db: Database, userId: string): Promise<boolean> {
  const bought = await db
    .select({ userId: fullAccess.userId })
    .from(fullAccess)
    .where(
      and(
        eq(fullAccess.userId, userId),
        isNotNull(fullAccess.paidAt),
        isNull(fullAccess.refundedAt)
      )
    )
  if (bought.length > 0) return true
  const paidBefore = await db
    .select({ userId: tootPayments.userId })
    .from(tootPayments)
    .where(
      and(
        eq(tootPayments.userId, userId),
        isNotNull(tootPayments.paidAt),
        isNull(tootPayments.refundedAt)
      )
    )
    .limit(1)
  return paidBefore.length > 0
}

/** The account's purchase, paid or not, or null when it never started one. */
export async function fullAccessPurchase(
  db: Database,
  userId: string
): Promise<FullAccessRow | null> {
  const [row] = await db.select().from(fullAccess).where(eq(fullAccess.userId, userId))
  return row ?? null
}

/**
 * Records `checkoutSessionId` as the latest Checkout Session for the account's Full Access. A paid
 * purchase keeps its row as it is, until it's refunded: then this one starts over.
 */
export async function startFullAccess(
  db: Database,
  userId: string,
  checkoutSessionId: string,
  price: { amount: number; currency: string }
): Promise<void> {
  const row = {
    checkoutSessionId,
    paymentIntent: null,
    amount: price.amount,
    currency: price.currency,
    createdAt: sql`${d1Now}`
  }
  await db
    .insert(fullAccess)
    .values({ userId, ...row })
    .onConflictDoUpdate({
      target: fullAccess.userId,
      set: { ...row, paidAt: null, refundedAt: null },
      setWhere: or(isNull(fullAccess.paidAt), isNotNull(fullAccess.refundedAt))
    })
}

/**
 * Marks the account's purchase paid by `checkoutSessionId`, once. Only a purchase started here
 * (`startFullAccess`) can be: a user deleted since has no row. `active`: the account has Full Access
 * now. `firstPaid`: this call is the one that made the purchase paid, as one UPDATE alone can, so
 * however Stripe's webhook and the return from Checkout race or repeat, each purchase has one. A
 * purchase started again after a refund has its own. Counts the funnel's `paid` step then (#405).
 */
export async function markFullAccessPaid(
  db: Database,
  userId: string,
  checkoutSessionId: string,
  paymentIntent: string | null
): Promise<{ active: boolean; firstPaid: boolean }> {
  const marked = await db
    .update(fullAccess)
    .set({ checkoutSessionId, paymentIntent, paidAt: sql`${d1Now}` })
    .where(and(eq(fullAccess.userId, userId), isNull(fullAccess.paidAt)))
    .returning({ userId: fullAccess.userId })
  const firstPaid = marked.length > 0
  if (firstPaid) await countStep(db, 'paid')
  return { active: await hasFullAccess(db, userId), firstPaid }
}

/** Ends the Full Access that Stripe's payment `paymentIntent` bought: it's fully refunded. */
export async function refundFullAccess(db: Database, paymentIntent: string): Promise<void> {
  await db
    .update(fullAccess)
    .set({ refundedAt: sql`${d1Now}` })
    .where(and(eq(fullAccess.paymentIntent, paymentIntent), isNull(fullAccess.refundedAt)))
}

/** The Toot's payment from before Full Access, or null when there's none. */
export async function tootPayment(
  db: Database,
  userId: string,
  tootId: string
): Promise<TootPaymentRow | null> {
  const [row] = await db.select().from(tootPayments).where(whereToot(userId, tootId))
  return row ?? null
}

/**
 * Marks a Toot payment from before Full Access paid by `checkoutSessionId`, once: a session still
 * open when Full Access came. Counts the funnel's `paid` step the once it becomes paid (#405).
 */
export async function markTootPaid(
  db: Database,
  userId: string,
  tootId: string,
  checkoutSessionId: string
): Promise<void> {
  const marked = await db
    .update(tootPayments)
    .set({ checkoutSessionId, paidAt: sql`${d1Now}` })
    .where(and(whereToot(userId, tootId), isNull(tootPayments.paidAt)))
    .returning({ tootId: tootPayments.tootId })
  if (marked.length > 0) await countStep(db, 'paid')
}

/** Marks a Toot payment from before Full Access refunded: it stops giving Full Access. */
export async function refundTootPayment(
  db: Database,
  userId: string,
  tootId: string
): Promise<void> {
  await db
    .update(tootPayments)
    .set({ refundedAt: sql`${d1Now}` })
    .where(and(whereToot(userId, tootId), isNull(tootPayments.refundedAt)))
}
