import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearOfferReturn,
  clearPaymentPending,
  markOfferSeen,
  notePaymentPending,
  offerWasSeen,
  PAYMENT_PENDING_MS,
  paymentPending,
  readOfferReturn,
  readPaidReturn
} from './full-access-offers'
import { blockedStorage, memoryStorage } from './test-storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('with storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('gives each place its own one go', () => {
    expect(offerWasSeen('welcome')).toBe(false)
    expect(offerWasSeen('result')).toBe(false)
    markOfferSeen('welcome')
    expect(offerWasSeen('welcome')).toBe(true)
    expect(offerWasSeen('result')).toBe(false)
  })

  it('remembers a payment on its way for that account alone, until it’s cleared', () => {
    notePaymentPending('userA', 1_000)
    expect(paymentPending('userA', 1_000)).toBe(true)
    expect(paymentPending('userB', 1_000)).toBe(false)
    clearPaymentPending()
    expect(paymentPending('userA', 1_000)).toBe(false)
  })

  it('stops remembering a payment that hasn’t come in an hour, so the account can try again', () => {
    notePaymentPending('userA', 1_000)
    expect(paymentPending('userA', 1_000 + PAYMENT_PENDING_MS - 1)).toBe(true)
    expect(paymentPending('userA', 1_000 + PAYMENT_PENDING_MS)).toBe(false)
  })

  it('ignores what it can’t read', () => {
    for (const stored of ['not json', '"text"', '{"accountId":"userA"}', '{"at":1000}']) {
      localStorage.setItem('pedos.fullAccess.paymentPending', stored)
      expect(paymentPending('userA', 1_000)).toBe(false)
    }
  })
})

describe('with storage blocked', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', blockedStorage())
  })

  it('never offers, as it couldn’t keep to one go', () => {
    expect(offerWasSeen('welcome')).toBe(true)
    expect(offerWasSeen('result')).toBe(true)
    expect(() => markOfferSeen('welcome')).not.toThrow()
  })

  it('can’t remember a payment, and doesn’t throw', () => {
    expect(() => notePaymentPending('userA')).not.toThrow()
    expect(paymentPending('userA')).toBe(false)
    expect(() => clearPaymentPending()).not.toThrow()
  })
})

describe('the return from Checkout', () => {
  it('is only `offer=done`, never Save’s or Download’s return', () => {
    expect(readOfferReturn('?offer=done')).toBe(true)
    expect(readOfferReturn('?a=1&offer=done')).toBe(true)
    expect(readOfferReturn('')).toBe(false)
    expect(readOfferReturn('?offer=later')).toBe(false)
    expect(readOfferReturn('?toot=x&checkout=done')).toBe(false)
  })

  it('from paying anywhere is an offer’s, Save’s or Download’s, and never a cancelled one', () => {
    expect(readPaidReturn('?offer=done')).toBe(true)
    expect(readPaidReturn('?toot=x&checkout=done')).toBe(true)
    expect(readPaidReturn('?id=x&checkout=done')).toBe(true)
    expect(readPaidReturn('')).toBe(false)
    expect(readPaidReturn('?toot=x')).toBe(false)
    expect(readPaidReturn('?id=x')).toBe(false)
    expect(readPaidReturn('?checkout=later')).toBe(false)
    expect(readPaidReturn('?offer=later')).toBe(false)
  })

  it('comes off the address, leaving the rest', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { href: 'https://farty.fm/recordings/?a=1&offer=done' },
      history: { replaceState }
    })
    clearOfferReturn()
    expect(String(replaceState.mock.calls[0][2])).toBe('https://farty.fm/recordings/?a=1')
  })
})
