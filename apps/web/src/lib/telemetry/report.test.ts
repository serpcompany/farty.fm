import { describe, expect, it } from 'vitest'
import { MAX_DELAY_SECONDS, parseReport, screenOf } from './report'

const report = {
  code: 'toot-make-failed',
  name: 'TypeError',
  screen: 'compose',
  release: '1.2.0+1bb4403',
  environment: 'staging',
  delaySeconds: 0
}

describe('parseReport', () => {
  it('keeps a report that is exactly a known code and bounded fields', () => {
    expect(parseReport(report)).toEqual(report)
  })

  it('keeps a report with no error type', () => {
    const { name: _, ...withoutName } = report
    expect(parseReport(withoutName)).toEqual(withoutName)
  })

  it.each<[string, Record<string, unknown>]>([
    ['an unknown code', { code: 'something-else' }],
    ['an unknown screen', { screen: 'admin' }],
    ['an unknown environment', { environment: 'dev' }],
    ['a message for a name', { name: 'Cannot read properties of undefined' }],
    ['an email for a name', { name: 'test@example.com' }],
    ['a name over 40 characters', { name: `E${'x'.repeat(40)}` }],
    ['a release over 40 characters', { release: '1'.repeat(41) }],
    ['a release with a space', { release: '1.2.0 beta' }],
    ['a negative wait', { delaySeconds: -1 }],
    ['a fractional wait', { delaySeconds: 1.5 }],
    ['a wait over a week', { delaySeconds: MAX_DELAY_SECONDS + 1 }],
    ['an extra field', { message: 'test@example.com' }],
    ['a missing release', { release: undefined }]
  ])('refuses %s', (_, change) => {
    expect(parseReport({ ...report, ...change })).toBeNull()
  })

  it.each([null, 'toot-make-failed', [report], 42])('refuses %j, which is no report', value => {
    expect(parseReport(value)).toBeNull()
  })
})

describe('screenOf', () => {
  it.each([
    ['/', 'record'],
    ['/compose/2f1c/', 'compose'],
    ['/recordings/', 'recordings'],
    ['/toots/2f1c/', 'toots'],
    ['/profile/', 'profile'],
    ['/dev/telemetry/', 'dev'],
    ['/somewhere/else/', 'other']
  ])('names %s by its first segment only: %s', (path, screen) => {
    expect(screenOf(path)).toBe(screen)
  })
})
