import { describe, expect, it } from 'vitest'

import {
  handleMessage,
  handleProblem,
  isHandlePage,
  normalizeHandle,
  profilePath,
  segmentHandle,
  suggestHandle
} from './handle'

describe('Handles', () => {
  it('are typed with or without the @, in any case', () => {
    expect(normalizeHandle('  @Maya_K ')).toBe('maya_k')
  })

  it("can't hold an @ or a /, so a page's path names one Handle (#382)", () => {
    for (const handle of ['ma@ya', 'maya@', '@maya', 'ma/ya', 'maya/', 'ma%40ya', 'ma%2fya']) {
      expect(handleProblem(handle), handle).toBe('chars')
    }
    // Typed with two, the second stays.
    expect(handleProblem(normalizeHandle('@@maya'))).toBe('chars')
  })

  it('name their page /@<handle>/, and a path names one only after its @ (#382)', () => {
    expect(profilePath('maya')).toBe('/@maya/')
    expect(segmentHandle('@maya')).toBe('maya')
    expect(segmentHandle('%40maya')).toBe('maya')
    expect(segmentHandle('maya')).toBeNull()
    expect(segmentHandle('u')).toBeNull()
    expect(segmentHandle('%E0%A4%A')).toBeNull()
    expect(isHandlePage('/@maya/')).toBe(true)
    expect(isHandlePage('/@maya/t/abcdefghjkmn/')).toBe(true)
    expect(isHandlePage('/%40maya/')).toBe(true)
    expect(isHandlePage('/maya/')).toBe(false)
    expect(isHandlePage('/recordings/')).toBe(false)
  })

  it('are 3 to 20 letters, digits or _', () => {
    expect(handleProblem('maya')).toBeNull()
    expect(handleProblem('m_9')).toBeNull()
    expect(handleProblem('a'.repeat(20))).toBeNull()
    expect(handleProblem('ma')).toBe('short')
    expect(handleProblem('a'.repeat(21))).toBe('long')
    expect(handleProblem('maya.k')).toBe('chars')
    expect(handleProblem('mäya')).toBe('chars')
    expect(handleProblem('')).toBe('short')
  })

  it("can't pass for Farty or one of its pages", () => {
    for (const handle of ['farty', 'admin', 'support', 'api', 'app', 'help', 'far_ty', 'privacy']) {
      expect(handleProblem(handle), handle).toBe('blocked')
    }
  })

  it("can't hold Farty's own name anywhere, or a staff word as a word of its own", () => {
    const passing = [
      'farty_official',
      'fartyteam',
      'farty_support',
      'f4rty',
      'farty1',
      'f_a_r_t_y',
      'pedos_admin',
      'p3d05',
      'the_farty_fan',
      'admin_maya',
      'maya_admin',
      'official_gus',
      'staff_pick',
      'team_gus',
      'gus_t34m',
      '4dm1n_gus',
      'farty_team',
      'team',
      'staff',
      'support_farty',
      'admin',
      'ad_min'
    ]
    for (const handle of passing) expect(handleProblem(handle), handle).toBe('blocked')
    const ordinary = [
      'maya',
      'gus',
      'fart_king',
      'fartmaster',
      'toot_toot',
      'maya_k',
      'm_9',
      'sir_toots_alot',
      'steamboat',
      'my_staffy_dog',
      'badminton',
      'steam',
      'teammate',
      'teamaker',
      'toot_teamwork',
      'support99',
      'staffan'
    ]
    for (const handle of ordinary) expect(handleProblem(handle), handle).toBeNull()
    // `.` isn't allowed in a Handle at all, so this one is refused before the block list.
    expect(handleProblem('pedos.admin')).toBe('chars')
  })

  it("can't hold a slur, even with digits for letters, but fart words and lookalikes are fine", () => {
    for (const handle of ['n4z1', 'na_zi_fan', 'xhitlerx', 'coon', 'spic_99', 'fags']) {
      expect(handleProblem(handle), handle).toBe('blocked')
    }
    for (const handle of ['spicy_toots', 'raccoon', 'fartmaster', 'pakistan_fan', 'cocoon']) {
      expect(handleProblem(handle), handle).toBeNull()
    }
  })

  it('are suggested from the email, padded or cut to fit', () => {
    expect(suggestHandle('Maya.K+fart@example.com')).toBe('mayakfart')
    expect(suggestHandle('farty.fan@example.com')).toBe('')
    expect(suggestHandle('jo@example.com')).toBe('jofart')
    expect(suggestHandle(`${'a'.repeat(30)}@example.com`)).toBe('a'.repeat(20))
    expect(suggestHandle('admin@example.com')).toBe('')
  })

  it('say what is wrong, as the prototype does', () => {
    expect(handleMessage('gus', 'taken')).toBe('@gus is taken. Try another.')
    expect(handleMessage('farty', 'blocked')).toBe("@farty isn't allowed. Try another.")
    expect(handleMessage('ma', 'short')).toBe('Use at least 3 characters.')
    expect(handleMessage('maya', null)).toBe('@maya is free')
  })
})
