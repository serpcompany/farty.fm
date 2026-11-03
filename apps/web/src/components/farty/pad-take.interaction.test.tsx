import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Recording } from '@/lib/recordings'
import {
  B,
  byTestId,
  click,
  draftOf,
  ID,
  keepTakes,
  kept,
  lastSave,
  later,
  lostSays,
  mockSoundPadPage,
  ofDeleted,
  one,
  open,
  PAID,
  page,
  paying,
  press,
  recording,
  recordingNumbered,
  signedInWherePaid,
  takeOf,
  USED,
  withTwoRecordings
} from '@/test-support/sound-pad-page'

mockSoundPadPage()

function expectPaidTakeLost() {
  expect(page.makePadToot).not.toHaveBeenCalled()
  expect(byTestId('pad-take-lost')?.textContent).toContain(lostSays)
  expect(page.reportError).toHaveBeenCalledExactlyOnceWith('pad-paid-take-lost')
  expect(kept()).toEqual([])
}

describe('a kept take on the Sound Pad', () => {
  withTwoRecordings()

  describe('opened again', () => {
    it('shows the newest kept take, and lets go of one saved or that can’t be made', async () => {
      keepTakes(takeOf(ID, one), takeOf(PAID, ofDeleted), takeOf(USED, one))
      page.saved.add(USED)
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.makePadToot).toHaveBeenCalledOnce()
      expect(page.makePadToot).toHaveBeenCalledWith(one, ID)
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
      expect(kept()).toEqual([takeOf(ID, one)])
      expect(page.tootPaymentState).not.toHaveBeenCalled()
    })

    it('saves a paid take whose return from Checkout never loaded, and lets go of a used one', async () => {
      signedInWherePaid()
      keepTakes(paying(PAID, one), paying(USED, one))
      page.tootPaymentState.mockImplementation(async (id: string) =>
        id === PAID ? 'unused' : 'used'
      )
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.tootPaymentState).toHaveBeenCalledWith(USED, 'userA')
      expect(page.tootPaymentState).toHaveBeenCalledWith(PAID, 'userA')
      expect(page.makePadToot).toHaveBeenLastCalledWith(one, PAID)
      expect(lastSave()).toMatchObject({
        draft: draftOf(one, PAID),
        back: { tootId: PAID, done: true }
      })
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
      expect(kept()).toEqual([paying(PAID, one)])
    })

    it.each([
      ['unpaid', 'unpaid'],
      ['not known', null]
    ])('keeps a take whose payment is %s, and saves nothing it wasn’t paid for', async (_, state) => {
      signedInWherePaid()
      keepTakes(paying(ID, one))
      page.tootPaymentState.mockResolvedValue(state)
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.tootPaymentState).toHaveBeenCalledWith(ID, 'userA')
      expect(lastSave()).toMatchObject({ draft: draftOf(one, ID), back: null })
      expect(kept()).toEqual([paying(ID, one)])
    })

    it.each([
      ['unpaid', 'unpaid'],
      ['not known', null]
    ])('keeps a take it can’t make whose payment is %s: its webhook may not have landed', async (_, state) => {
      signedInWherePaid()
      keepTakes(paying(ID, ofDeleted))
      page.tootPaymentState.mockResolvedValue(state)
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.tootPaymentState).toHaveBeenCalledWith(ID, 'userA')
      expect(page.makePadToot).not.toHaveBeenCalled()
      expect(byTestId('pad-take-state')?.textContent).toBe('Record')
      expect(byTestId('pad-take-lost')).toBeNull()
      expect(kept()).toEqual([paying(ID, ofDeleted)])
    })

    it('takes a take off the Pad once its payment turns out used, so it never asks to pay again', async () => {
      signedInWherePaid()
      keepTakes(paying(USED, one))
      const answer = later<'used'>()
      page.tootPaymentState.mockReturnValue(answer.promise)
      await open(Promise.resolve({} as AudioBuffer))
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      await act(async () => answer.resolve('used'))
      expect(byTestId('pad-take-state')?.textContent).toBe('Record')
      expect(document.body.textContent).not.toContain('Save to Toots')
      expect(kept()).toEqual([])
    })

    it('keeps a take it can’t make again where saving is paid, and offers to try again', async () => {
      signedInWherePaid()
      keepTakes(paying(PAID, one))
      page.tootPaymentState.mockReturnValue(new Promise(() => {}))
      const broken = new Error('Rendering failed')
      page.makePadToot.mockRejectedValueOnce(broken)
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.reportError).toHaveBeenCalledWith('toot-make-failed', broken)
      expect(document.body.textContent).toContain("Couldn't make this Toot.")
      expect(kept()).toEqual([paying(PAID, one)])
      const retry = [...document.querySelectorAll('button')].find(
        b => b.textContent === 'Try again'
      )
      await act(async () => retry?.click())
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(kept()).toEqual([paying(PAID, one)])
    })

    it('lets go of a take it can’t make again where saving is free', async () => {
      keepTakes(takeOf(ID, one))
      page.makePadToot.mockRejectedValueOnce(new Error('Rendering failed'))
      await open(Promise.resolve({} as AudioBuffer))
      expect(byTestId('pad-take-state')?.textContent).toBe('Record')
      expect(kept()).toEqual([])
    })

    it('never shows another account’s take, nor a guest’s, to this one', async () => {
      signedInWherePaid()
      keepTakes(
        takeOf(ID, one),
        takeOf(PAID, one, { account: 'userB', checkout: true }),
        takeOf(USED, one, { account: 'userB' })
      )
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.makePadToot).not.toHaveBeenCalled()
      expect(page.tootPaymentState).not.toHaveBeenCalled()
      expect(byTestId('pad-take-state')?.textContent).toBe('Record')
      expect(kept()).toHaveLength(3)
    })

    it('says a paid take whose Recording was deleted can’t be made again, and reports it', async () => {
      signedInWherePaid()
      keepTakes(paying(PAID, ofDeleted))
      page.tootPaymentState.mockResolvedValue('unused')
      await open(Promise.resolve({} as AudioBuffer))
      expectPaidTakeLost()
      await click('pad-take-record')
      expect(byTestId('pad-take-lost')).toBeNull()
    })

    describe('signed in again, before the account’s changes are read', () => {
      beforeEach(() => {
        signedInWherePaid()
        page.pulled = null
        page.recordings = []
        keepTakes(paying(PAID, one))
        page.tootPaymentState.mockResolvedValue('unused')
      })
      async function pulled(brought: Recording[]) {
        page.recordings = brought
        page.pulled = 'userA'
        await act(async () => {
          for (const listener of page.onPulled) listener()
        })
      }

      it('keeps a paid take whose Recordings aren’t here yet, and saves it once they are', async () => {
        await open(Promise.resolve({} as AudioBuffer))
        expect(page.tootPaymentState).toHaveBeenCalledWith(PAID, 'userA')
        expect(page.makePadToot).not.toHaveBeenCalled()
        expect(byTestId('pad-take-lost')).toBeNull()
        expect(page.reportError).not.toHaveBeenCalled()
        expect(kept()).toEqual([paying(PAID, one)])

        await pulled([recording, recordingNumbered(B, 2)])
        expect(page.makePadToot).toHaveBeenCalledExactlyOnceWith(one, PAID)
        expect(lastSave()).toMatchObject({
          draft: draftOf(one, PAID),
          back: { tootId: PAID, done: true }
        })
        expect(byTestId('pad-take-lost')).toBeNull()
        expect(kept()).toEqual([paying(PAID, one)])
      })

      it('saves it when they arrive before the account says it’s paid', async () => {
        const answer = later<'unused'>()
        page.tootPaymentState.mockReturnValue(answer.promise)
        await open(Promise.resolve({} as AudioBuffer))
        await pulled([recording])
        await act(async () => answer.resolve('unused'))
        expect(page.makePadToot).toHaveBeenCalledExactlyOnceWith(one, PAID)
        expect(byTestId('pad-take-lost')).toBeNull()
      })

      it('says it’s lost, and reports it, once read without its Recording', async () => {
        await open(Promise.resolve({} as AudioBuffer))
        expect(byTestId('pad-take-lost')).toBeNull()
        await pulled([recordingNumbered(B, 2)])
        expectPaidTakeLost()
      })

      it('waits for them back from Checkout too', async () => {
        page.tootPaymentState.mockReturnValue(new Promise(() => {}))
        window.history.replaceState(null, '', `/compose/pad/?toot=${PAID}&checkout=done`)
        await open(Promise.resolve({} as AudioBuffer))
        expect(page.makePadToot).not.toHaveBeenCalled()
        expect(byTestId('pad-take-lost')).toBeNull()
        expect(kept()).toEqual([paying(PAID, one)])

        await pulled([recording])
        expect(page.makePadToot).toHaveBeenCalledExactlyOnceWith(one, PAID)
        expect(lastSave()).toMatchObject({ back: { tootId: PAID, done: true } })
      })

      it('keeps a take it’s waiting for when Record is pressed meanwhile', async () => {
        page.recordings = [recordingNumbered(B, 2)]
        await open(Promise.resolve({} as AudioBuffer))
        await click('pad-take-record')
        await pulled([recordingNumbered(B, 2)])
        expect(byTestId('pad-take-lost')).toBeNull()
        expect(page.reportError).not.toHaveBeenCalled()
        expect(kept()).toEqual([paying(PAID, one)])
      })
    })

    it('never takes the place of a take being recorded', async () => {
      signedInWherePaid()
      const answer = later<'unused'>()
      page.tootPaymentState.mockReturnValue(answer.promise)
      keepTakes(paying(PAID, one))
      await open(Promise.resolve({} as AudioBuffer))
      await click('pad-take-again')
      await press(1, window.performance.now())
      await act(async () => answer.resolve('unused'))
      expect(byTestId('pad-take-state')?.textContent).toBe('0:00 of 0:30')
      expect(kept()).toEqual([paying(PAID, one)])
    })
  })

  describe('back from Checkout', () => {
    it('is made again with the id it was paid for, without playing', async () => {
      keepTakes(takeOf(ID, one), takeOf(PAID, one))
      window.history.replaceState(null, '', `/compose/pad/?toot=${ID}&checkout=done`)
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.makePadToot).toHaveBeenCalledExactlyOnceWith(one, ID)
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
      expect(lastSave()).toMatchObject({ draft: draftOf(one), back: { tootId: ID, done: true } })
    })

    it('says a paid take that isn’t kept any more couldn’t be made again, and reports it', async () => {
      window.history.replaceState(null, '', `/compose/pad/?toot=${ID}&checkout=done`)
      await open(Promise.resolve({} as AudioBuffer))
      expect(page.makePadToot).not.toHaveBeenCalled()
      expect(window.location.search).toBe('')
      expect(byTestId('pad-take-lost')?.textContent).toContain(lostSays)
      expect(page.reportError).toHaveBeenCalledExactlyOnceWith('pad-paid-take-lost')
    })

    it('says so too when the paid take played a Recording deleted since', async () => {
      keepTakes(takeOf(ID, ofDeleted))
      window.history.replaceState(null, '', `/compose/pad/?toot=${ID}&checkout=done`)
      await open(Promise.resolve({} as AudioBuffer))
      expectPaidTakeLost()
    })

    it('clears a cancelled return for a take not kept, and says nothing', async () => {
      window.history.replaceState(null, '', `/compose/pad/?toot=${ID}`)
      await open(Promise.resolve({} as AudioBuffer))
      expect(window.location.search).toBe('')
      expect(byTestId('pad-take-lost')).toBeNull()
      expect(page.reportError).not.toHaveBeenCalled()
    })
  })
})
