import type { Page } from '@playwright/test'
import { fartAndRecord, waitForOpenMicrophone, withFartingMicrophone } from './fake-microphone'
import { onPhone } from './screens'
import { expect, test } from './test'

function keepConnections(): void {
  const connections: IDBDatabase[] = []
  Object.assign(window, { pedosConnections: connections })
  const open = IDBFactory.prototype.open
  IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
    const request = open.apply(this, args)
    request.addEventListener('success', () => connections.push(request.result))
    return request
  }
}

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
  test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
  withFartingMicrophone()

  test.beforeEach(async ({ page }) => {
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

      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(page).toHaveURL(/\/recordings\/$/)
      await expect(page.getByTestId('recording-row')).toHaveCount(1)
      await expect(page.getByTestId('recording-note')).toHaveText('G3')
    })
  }
})
