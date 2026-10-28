import { describe, expect, test } from 'vitest'
import { tabOf, tabs } from './tabs'

describe('tabs', () => {
  test("are the iPhone app's five, in its order, with Record in the center", () => {
    expect(tabs.map(tab => tab.label)).toEqual([
      'Recordings',
      'Compose',
      'Record',
      'Toots',
      'Profile'
    ])
  })

  test.each([
    [[], 'record'],
    [['recordings'], 'recordings'],
    [['compose'], 'compose'],
    [['compose', 'twinkle'], 'compose'],
    [['toots'], 'toots'],
    [['toots', 'toot'], 'toots'],
    [['profile'], 'profile']
  ])('%j is on %s', (segments, tab) => {
    expect(tabOf(segments)).toBe(tab)
  })

  test.each([[['privacy']], [['composer']], [['/_not-found']]])('%j is on no tab', segments => {
    expect(tabOf(segments)).toBeNull()
  })
})
