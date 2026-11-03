import { peak, savedTake } from './database'
import { fartAndSave, withFartingMicrophone } from './record'
import { onPhone } from './screens'
import { expect, test } from './test'

const peaksAbout50dBBelowFullLevel = -49

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone()

test('a fart 50 dB below full level is heard, saved at full level and analyzed as it is', async ({
  page
}) => {
  await page.goto('/')
  await fartAndSave(page, '090', { gainDb: peaksAbout50dBBelowFullLevel })
  await expect(page.getByTestId('result-note')).toHaveText('G3')

  const take = await savedTake(page)
  expect(20 * Math.log10(peak(take.samples))).toBeCloseTo(-1, 0)
})
