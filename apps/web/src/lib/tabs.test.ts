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
    ['/', 'record'],
    ['/recordings/', 'recordings'],
    ['/recordings', 'recordings'],
    ['/compose/', 'compose'],
    ['/compose/twinkle/', 'compose'],
    ['/compose/pad/', 'compose'],
    ['/toots/', 'toots'],
    ['/toots/3f2a/', 'toots'],
    ['/profile/', 'profile']
  ])('%s is on %s', (path, tab) => {
    expect(tabOf(path)).toBe(tab)
  })

  test.each(['/privacy/', '/composer/', '/recordingsx'])('%s is on no tab', path => {
    expect(tabOf(path)).toBeNull()
  })
})
