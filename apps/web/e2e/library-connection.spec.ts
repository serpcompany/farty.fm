import { expect, type Page, test } from '@playwright/test'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// A Farty tab left open while the phone sleeps can lose its IndexedDB connection: WebKit drops it
// ("Connection to Indexed Database server lost"), and clearing site data closes it (#222). Saving
// a Recording still works, on a fresh connection.

/** An init script: keeps each IndexedDB connection the page opens, so the test can close it. */
function keepConnections(): void {
  const connections: IDBDatabase[] = []
  ;(window as unknown as { pedosConnections: IDBDatabase[] }).pedosConnections = connections
  const open = IDBFactory.prototype.open
  IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
    const request = open.apply(this, args)
    request.addEventListener('success', () => connections.push(request.result))
    return request
  }
}

/**
 * Closes every connection the app holds. `announced` fires the `close` event too, as when the
 * browser closes one; without it, the app learns only when its next request fails.
 */
function closeConnections(page: Page, { announced }: { announced: boolean }): Promise<number> {
  return page.evaluate(withEvent => {
    const connections = (window as unknown as { pedosConnections: IDBDatabase[] }).pedosConnections
    for (const connection of connections) {
      connection.close()
      if (withEvent) connection.dispatchEvent(new Event('close'))
    }
    return connections.length
  }, announced)
}

test.describe('when the database connection is lost', () => {
  test.use({ permissions: ['microphone'] })
  test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
    await page.addInitScript(skipWelcome)
    await page.addInitScript(keepConnections)
  })

  for (const announced of [false, true]) {
    test(`saving a Recording still works (${announced ? 'closed by the browser' : 'lost without a word'})`, async ({
      page
    }) => {
      await page.goto('/')
      await waitForOpenMicrophone(page)
      await fartAndRecord(page)
      expect(await closeConnections(page, { announced })).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByTestId('result-note')).toHaveText('G3')

      // It's in the library.
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(page).toHaveURL(/\/recordings\/$/)
      await expect(page.getByTestId('recording-row')).toHaveCount(1)
      await expect(page.getByTestId('recording-note')).toHaveText('G3')
    })
  }
})
