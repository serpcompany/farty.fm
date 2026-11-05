import { sql } from 'drizzle-orm'

import type { Step } from '@/lib/telemetry/step-names'

import type { Database } from './database'
import { stepCounts } from './schema'

// How many times each step of the funnel was counted, per day (#405). A row is only a day, a step
// and a number.

/** Adds one to today's count of `step`. */
export async function addStepCount(db: Database, step: Step): Promise<void> {
  await db
    .insert(stepCounts)
    .values({ day: sql`date('now')`, step, count: 1 })
    .onConflictDoUpdate({
      target: [stepCounts.day, stepCounts.step],
      set: { count: sql`${stepCounts.count} + 1` }
    })
}

/**
 * `addStepCount` for the server's own steps, which never throws: a count that can't be kept never
 * breaks the Checkout or payment it's counting.
 */
export async function countStep(db: Database, step: Step): Promise<void> {
  try {
    await addStepCount(db, step)
  } catch {
    console.error(JSON.stringify({ event: 'step_count_failed', step }))
  }
}
