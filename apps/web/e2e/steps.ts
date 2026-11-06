import { expect, type Page } from '@playwright/test'

// The funnel's steps (#405) in the journeys.

/** Every step this page sends, from now on, with what else its body held. */
export function stepsFrom(page: Page): string[] {
  const sent: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/steps/') return
    const { step, ...rest } = request.postDataJSON() as { step: string }
    expect(rest).toEqual({})
    sent.push(step)
  })
  return sent
}

/** Waits long enough for a step the page would send to have gone, across a navigation too. */
export const aMoment = (page: Page) => page.waitForTimeout(500)
