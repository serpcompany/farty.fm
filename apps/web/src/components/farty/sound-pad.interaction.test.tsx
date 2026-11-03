import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Performance } from '@/lib/performance'
import type { PadTootDraft } from '@/lib/toot'
import {
  A,
  B,
  byTestId,
  click,
  draftOf,
  kept,
  lastSave,
  later,
  leave,
  mockSoundPadPage,
  one,
  open,
  pad,
  page,
  press,
  recordOneTap,
  setVisibility,
  takeOf,
  withTwoRecordings
} from '@/test-support/sound-pad-page'

mockSoundPadPage()
const { PadAudioUnavailable } = await import('@/lib/audio/pad-player')

describe('a press on a Pad', () => {
  it('is dropped while its sound loads, so presses never start together later', async () => {
    const sound = later<AudioBuffer>()
    await open(sound.promise)
    expect(pad().getAttribute('aria-busy')).toBe('true')
    expect(pad().getAttribute('aria-label')).toBe('Pad 1. noise-like, Recording 1. Loading')
    await press()
    await press()
    await press()
    const buffer = {} as AudioBuffer
    await act(async () => sound.resolve(buffer))
    expect(page.playPadSound).not.toHaveBeenCalled()
    expect(pad().dataset.ready).toBe('true')
    expect(pad().hasAttribute('aria-busy')).toBe(false)
    await press()
    expect(page.playPadSound).toHaveBeenCalledTimes(1)
    expect(page.playPadSound).toHaveBeenCalledWith(buffer, expect.any(Function))
  })

  it('isn’t reported when the audio isn’t in this browser yet, and a press tries again', async () => {
    await open(Promise.reject(new PadAudioUnavailable(new Error('offline'))))
    expect(pad().getAttribute('aria-label')).toBe(
      'Pad 1. noise-like, Recording 1. Can’t play it yet'
    )
    expect(page.reportError).not.toHaveBeenCalled()
    expect(page.loadPadSound).toHaveBeenCalledTimes(1)
    await press()
    expect(page.loadPadSound).toHaveBeenCalledTimes(2)
    expect(page.playPadSound).not.toHaveBeenCalled()
    expect(page.reportError).not.toHaveBeenCalled()
  })

  it('reports a sound that won’t decode', async () => {
    const broken = new Error('Unable to decode audio data')
    await open(Promise.reject(broken))
    expect(page.reportError).toHaveBeenCalledWith('pad-sound-failed', broken)
    expect(page.playPadSound).not.toHaveBeenCalled()
  })
})

describe('a take on the Sound Pad', () => {
  withTwoRecordings()

  it('keeps what played from Record to Stop, timed from the first tap, then plays its Toot', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    await press(1, 500)
    expect(byTestId('pad-take-state')?.textContent).toBe('Record')

    await click('pad-take-record')
    expect(page.stopPlayback).toHaveBeenCalled()
    expect(byTestId('pad-take-state')?.textContent).toBe('Recording')
    expect(document.body.textContent).not.toContain('Edit')
    const t0 = window.performance.now()
    await press(1, t0)
    await press(2, t0 + 250)
    await press(1, t0 + 600.4)
    expect(page.playPadSound).toHaveBeenCalledTimes(4)
    expect(byTestId('pad-take-state')?.textContent).toBe('0:00 of 0:30')
    await click('pad-take-stop')

    const played: Performance = {
      recordings: [A, B],
      taps: [
        [0, 0],
        [0.25, 1],
        [0.6, 0]
      ]
    }
    const id: string = page.makePadToot.mock.lastCall?.[1]
    expect(page.makePadToot).toHaveBeenCalledWith(played, expect.any(String))
    expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
    expect(document.body.textContent).toContain('0:01 · 3 taps of 2 Recordings')
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(draftOf(played, id))
    expect(lastSave()).toEqual({
      draft: draftOf(played, id),
      back: null,
      keep: expect.any(Function)
    })
    expect(kept()).toEqual([takeOf(id, played)])
    expect(lastSave().keep('userA')).toBe(true)
    expect(kept()).toEqual([takeOf(id, played, { account: 'userA', checkout: true })])

    await click('pad-take-again')
    expect(byTestId('pad-take-state')?.textContent).toBe('Recording')
    expect(document.body.textContent).not.toContain('Save to Toots')
    await press(1, window.performance.now())
    await click('pad-take-stop')
    expect(kept()).toHaveLength(2)
  })

  it('is nothing when Stop comes before a tap', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    await click('pad-take-record')
    await click('pad-take-stop')
    expect(page.makePadToot).not.toHaveBeenCalled()
    expect(byTestId('pad-take-state')?.textContent).toBe('Record')
    expect(kept()).toEqual([])
  })

  it('says it couldn’t be made, and reports why', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    const broken = new Error('Rendering failed')
    page.makePadToot.mockRejectedValue(broken)
    await recordOneTap()
    await click('pad-take-stop')
    expect(document.body.textContent).toContain("Couldn't make this Toot.")
    expect(page.reportError).toHaveBeenCalledWith('toot-make-failed', broken)
  })

  it('can’t be kept for Checkout when storage won’t keep it', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    await recordOneTap()
    await click('pad-take-stop')
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(lastSave().keep('userA')).toBe(false)
    setItem.mockRestore()
  })

  describe('stopped by hiding the page', () => {
    it('is made, and never plays while hidden or by itself after', async () => {
      await open(Promise.resolve({} as AudioBuffer))
      await recordOneTap()
      await setVisibility('hidden')
      expect(page.makePadToot).toHaveBeenCalledWith(one, expect.any(String))
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      await setVisibility('visible')
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
      await click('pad-toot-play')
      expect(page.toggleTootPlayback).toHaveBeenCalledOnce()
    })

    it('never plays when the page hides while it’s made', async () => {
      const made = later<PadTootDraft>()
      page.makePadToot.mockReturnValue(made.promise)
      await open(Promise.resolve({} as AudioBuffer))
      await recordOneTap()
      await click('pad-take-stop')
      await setVisibility('hidden')
      await act(async () => made.resolve(draftOf(one)))
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
    })

    it('never plays by itself when the page is back before it’s made', async () => {
      const made = later<PadTootDraft>()
      page.makePadToot.mockReturnValue(made.promise)
      await open(Promise.resolve({} as AudioBuffer))
      await recordOneTap()
      await setVisibility('hidden')
      await setVisibility('visible')
      await act(async () => made.resolve(draftOf(one)))
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
    })

    it('is there again, ready to play, when the Pad opens after a phone comes back on Record', async () => {
      const made = later<PadTootDraft>()
      page.makePadToot.mockReturnValueOnce(made.promise)
      await open(Promise.resolve({} as AudioBuffer))
      await recordOneTap()
      await setVisibility('hidden')
      const id: string = page.makePadToot.mock.lastCall?.[1]
      await setVisibility('visible')
      leave()
      await act(async () => made.resolve(draftOf(one, id)))

      await open(Promise.resolve({} as AudioBuffer))
      expect(page.makePadToot).toHaveBeenLastCalledWith(one, id)
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(lastSave()).toMatchObject({ draft: draftOf(one, id), back: null })
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
    })
  })
})
