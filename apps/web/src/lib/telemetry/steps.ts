import { telemetryCredentials } from './errors'
import { sharingAllowed } from './sharing'
import { type BrowserStep, isBrowserStep } from './step-names'

/**
 * Counting the funnel's steps from the browser (#405): `reachStep(step)` tells `/api/steps/` a
 * step was reached, the first time this browser reaches it, and the server adds one to that day's
 * count. Nothing here throws or waits, and nothing but the step's name is sent.
 *
 * Only a browser that first showed Welcome after this shipped counts, so the funnel follows new
 * visitors: `open` has to come first. Sent only while sharing is on (`sharing.ts`). A step that
 * can't be sent waits on the device, and goes on the next step, when the browser is back online,
 * or on the next page load. With storage blocked nothing is counted, since nothing could stop this
 * browser counting the same step again.
 */

export const STEPS_PATH = '/api/steps/'

/** localStorage: each step this browser has reached. A new visit doesn't clear it (`visit.ts`). */
export const stepsKey = 'pedos.steps'

type Reached = Partial<Record<BrowserStep, 'waiting' | 'sent'>>

let flushing = false
let flushAgain = false
/** The page is going, so a send that fails now was cut off, and `keepalive` still finishes it. */
let leaving = false

function readReached(): Reached {
  const stored: unknown = JSON.parse(localStorage.getItem(stepsKey) ?? '{}')
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const reached: Reached = {}
  for (const [step, state] of Object.entries(stored)) {
    if (isBrowserStep(step) && (state === 'waiting' || state === 'sent')) reached[step] = state
  }
  return reached
}

function writeReached(reached: Reached): void {
  localStorage.setItem(stepsKey, JSON.stringify(reached))
}

/** Counts `step`, if this browser hasn't yet. Never throws. */
export function reachStep(step: BrowserStep): void {
  try {
    if (!sharingAllowed()) return
    const reached = readReached()
    if (reached[step] !== undefined) return
    if (step !== 'open' && reached.open === undefined) return
    // Storage that can't keep it throws here, and this browser counts nothing.
    writeReached({ ...reached, [step]: 'waiting' })
    void flushSteps()
  } catch {
    // Counting never breaks Farty.
  }
}

/** `done`, sent or refused for good, or `failed`, to try again later. */
async function send(step: BrowserStep): Promise<'done' | 'failed'> {
  try {
    const response = await fetch(STEPS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step }),
      credentials: telemetryCredentials(),
      keepalive: true
    })
    if (response.ok) return 'done'
    return response.status === 429 || response.status >= 500 ? 'failed' : 'done'
  } catch {
    return 'failed'
  }
}

function waiting(reached: Reached): BrowserStep[] {
  return (Object.keys(reached) as BrowserStep[]).filter(step => reached[step] === 'waiting')
}

/** Sends the waiting steps, oldest first, until one fails. Never throws. */
export async function flushSteps(): Promise<void> {
  if (flushing) {
    flushAgain = true
    return
  }
  flushing = true
  try {
    do {
      flushAgain = false
      if (!sharingAllowed()) {
        // Sharing turned off: what was waiting is never sent.
        const reached = readReached()
        const dropped = waiting(reached)
        for (const step of dropped) delete reached[step]
        if (dropped.length > 0) writeReached(reached)
        return
      }
      if (navigator.onLine === false) return
      for (const step of waiting(readReached())) {
        // Noted before it goes: `keepalive` finishes a send the page leaves behind, so the next
        // page mustn't send it again.
        writeReached({ ...readReached(), [step]: 'sent' })
        if ((await send(step)) === 'failed') {
          if (!leaving) writeReached({ ...readReached(), [step]: 'waiting' })
          return
        }
      }
    } while (flushAgain)
  } catch {
    // Left for the next try.
  } finally {
    flushing = false
  }
}

/** Sends the waiting steps now, and whenever the browser comes back online. Run once. */
export function installStepCounting(): void {
  try {
    window.addEventListener('online', () => void flushSteps())
    window.addEventListener('pagehide', () => {
      leaving = true
    })
    window.addEventListener('pageshow', () => {
      leaving = false
    })
    void flushSteps()
  } catch {
    // Counting never breaks Farty.
  }
}
