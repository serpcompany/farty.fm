import { describe, expect, it } from 'vitest'
import type { Account } from './account'
import { clearsOnOpen, type OpenFacts } from './visit'

const guestsNewVisit: OpenFacts = {
  account: { status: 'signedOut' },
  firstOpen: false,
  otherTabOpen: false
}

describe('clearsOnOpen', () => {
  it("clears a guest's farts when a new visit opens", () => {
    expect(clearsOnOpen(guestsNewVisit)).toBe(true)
  })

  it.each<Account>([
    { status: 'signedIn', email: 'a@example.com', marketingEmail: true },
    { status: 'unreachable' },
    { status: 'checking' }
  ])('keeps them unless the session reads as signed out ($status)', account => {
    expect(clearsOnOpen({ ...guestsNewVisit, account })).toBe(false)
  })

  it('keeps what a browser held from before guests kept nothing, for this visit', () => {
    expect(clearsOnOpen({ ...guestsNewVisit, firstOpen: true })).toBe(false)
  })

  it('keeps them while Pedos is open in another tab', () => {
    expect(clearsOnOpen({ ...guestsNewVisit, otherTabOpen: true })).toBe(false)
  })
})
