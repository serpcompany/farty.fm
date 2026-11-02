import { describe, expect, it } from 'vitest'

import { handleMessage, handleProblem, normalizeHandle, suggestHandle } from './handle'

describe('Handles', () => {
  it('are typed with or without the @, in any case', () => {
    expect(normalizeHandle('  @Maya_K ')).toBe('maya_k')
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
    expect(handleProblem('farty_fan')).toBeNull()
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
    expect(suggestHandle('Maya.K+farty@example.com')).toBe('mayakfarty')
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
