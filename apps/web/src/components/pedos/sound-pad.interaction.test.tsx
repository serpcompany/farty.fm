import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/lib/account'
import type { Performance } from '@/lib/performance'
import type { Recording } from '@/lib/recordings'
import type { PadTootDraft, TootDraft } from '@/lib/toot'

// The Sound Pad in a DOM: a press on a Pad whose sound isn't ready is dropped, never played later,
// and audio this browser can't get yet isn't reported, while a sound that won't decode is. Record
// keeps the presses that played as a Performance, made into a Toot to hear and save (#278): a take
// stopped by hiding the page never plays by itself, and is there again on the next open; a paid
// take is made again and saved, back from Checkout or on the next open, or said to be lost.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => ({
  loadPadSound: vi.fn(),
  playPadSound: vi.fn(),
  reportError: vi.fn(),
  makePadToot: vi.fn(),
  toggleTootPlayback: vi.fn(),
  stopPlayback: vi.fn(),
  forgetToot: vi.fn(),
  saveToToots: vi.fn(),
  tootPaymentState: vi.fn(),
  /** Whether this build's saving is paid. */
  paid: false,
  account: { status: 'signedOut' } as Account,
  /** The account whose changes this page has read (`libraryPulled`), and who hears it change. */
  pulled: null as string | null,
  onPulled: new Set<() => void>(),
  /** The ids of the saved Toots. */
  saved: new Set<string>()
}))

const recordingNumbered = (id: string, number: number): Recording => ({
  id,
  number,
  createdAt: 0,
  seconds: 1,
  sampleRate: 48000,
  waveform: [],
  analysis: {
    state: 'analyzed',
    analysis: {
      gestureStartSeconds: 0,
      gestureEndSeconds: 0.9,
      cutAtReattack: false,
      pitchEstimateMidi: null,
      pitchConfidence: 0,
      recordingPitchMidi: null,
      shortestNoteSeconds: null
    }
  }
})
/** Recording ids, as the library's. */
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const recording = recordingNumbered(A, 1)
/** The library: Recording 1, and for a take Recording 2 as well. */
let recordings = [recording]

vi.mock('./pedos-provider', () => ({
  // As the provider's: the library as this render has it.
  usePedos: () => {
    const list = recordings
    return {
      recordings: list,
      recording: (id: string) => list.find(r => r.id === id),
      makePadToot: page.makePadToot,
      toggleTootPlayback: page.toggleTootPlayback,
      stopPlayback: page.stopPlayback,
      forgetToot: page.forgetToot,
      toots: [],
      toot: (id: string) => (page.saved.has(id) ? {} : undefined),
      nowPlaying: null,
      tootPlayFailed: null
    }
  },
  tootPlayback: (id: string) => `toot:${id}`
}))
vi.mock('./account-provider', () => ({ useAccount: () => ({ account: page.account }) }))
vi.mock('@/lib/toot-payment', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/toot-payment')>()),
  saveAsksForPayment: () => page.paid,
  tootPaymentState: page.tootPaymentState
}))
// Save to Toots, as Song Creator's: its payment is tested there.
vi.mock('./song-creator', () => ({
  SaveToToots: (props: {
    draft: TootDraft
    back: unknown
    keep?: (accountId: string) => boolean
  }) => {
    page.saveToToots(props)
    return <button type="button">Save to Toots</button>
  }
}))
vi.mock('@/lib/audio/pad-player', async importOriginal => ({
  PadAudioUnavailable: (await importOriginal<typeof import('@/lib/audio/pad-player')>())
    .PadAudioUnavailable,
  loadPadSound: page.loadPadSound,
  playPadSound: page.playPadSound,
  keepPadSounds: () => undefined,
  stopPadSounds: () => undefined
}))
vi.mock('@/lib/audio/context', () => ({ startAudioInTap: () => undefined }))
vi.mock('@/lib/pad-store', () => ({ loadPads: async () => new Map(), savePads: async () => {} }))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => {}) }))
vi.mock('@/lib/library-sync', () => ({
  libraryPulled: () => page.pulled,
  onLibraryPulled: (listener: () => void) => {
    page.onPulled.add(listener)
    return () => page.onPulled.delete(listener)
  }
}))
vi.mock('@/lib/telemetry/errors', () => ({ reportError: page.reportError }))
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }))

const { PadAudioUnavailable } = await import('@/lib/audio/pad-player')
const { SoundPad } = await import('./sound-pad')

let root: Root | null = null

/** Opens the Sound Pad with Recording 1 on Pad 1 and 2 on Pad 2, their sounds loading with `sound`. */
async function open(sound: Promise<unknown>) {
  page.loadPadSound.mockReturnValue(sound)
  sound.catch(() => {})
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<SoundPad />))
}

const pad = (number = 1) => {
  const found = document.querySelector<HTMLButtonElement>(`[data-pad="${number}"]`)
  if (!found) throw new Error(`no Pad ${number}`)
  return found
}

/** Presses Pad `number`, at `at` (the event's `timeStamp`, as `performance.now()`). */
async function press(number = 1, at?: number) {
  const event = new PointerEvent('pointerdown', { bubbles: true, button: 0 })
  if (at !== undefined) Object.defineProperty(event, 'timeStamp', { value: at })
  await act(async () => {
    pad(number).dispatchEvent(event)
  })
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

async function click(id: string) {
  const button = byTestId(id)
  if (!button) throw new Error(`no ${id}`)
  await act(async () => button.click())
}

function later<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** Fakes the page going to the background (`hidden`) and coming back (`visible`). */
async function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** Leaves the Sound Pad, as a phone coming back to Farty does (it goes to Record). */
function leave() {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
}

beforeEach(() => {
  vi.clearAllMocks()
  page.paid = false
  page.account = { status: 'signedOut' }
  page.pulled = null
  page.saved = new Set()
})

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  localStorage.clear()
  window.history.replaceState(null, '', '/compose/pad/')
})

describe('a press on a Pad', () => {
  it('is dropped while its sound loads, so presses never start together later', async () => {
    const sound = later<AudioBuffer>()
    await open(sound.promise)
    expect(pad().getAttribute('aria-busy')).toBe('true')
    expect(pad().getAttribute('aria-label')).toBe('Pad 1. Recording 1, noise-like. Loading')
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
      'Pad 1. Recording 1, noise-like. Can’t play it yet'
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
  const ID = '11111111-1111-4111-8111-111111111111'
  const PAID = '22222222-2222-4222-8222-222222222222'
  const USED = '33333333-3333-4333-8333-333333333333'
  beforeEach(() => {
    recordings = [recording, recordingNumbered(B, 2)]
    page.makePadToot.mockImplementation(async (performance: Performance, id: string) =>
      draftOf(performance, id)
    )
  })
  afterEach(() => {
    recordings = [recording]
  })
  const draftOf = (performance: Performance, id = ID): PadTootDraft => ({
    id,
    song: null,
    performance,
    seconds: 1.2,
    wav: new ArrayBuffer(0)
  })
  const one: Performance = { recordings: [A], taps: [[0, 0]] }
  /** A take that played a Recording no longer in the library. */
  const ofDeleted: Performance = {
    recordings: ['00000000-0000-4000-8000-00000000000f'],
    taps: [[0, 0]]
  }
  const kept = () => JSON.parse(localStorage.getItem('pedos.padTakes') ?? '[]')
  /** A kept take, as `pad-take.ts` stores it: a guest's unless `account` says whose. */
  const takeOf = (
    tootId: string,
    performance: Performance,
    { account = null as string | null, checkout = false } = {}
  ) => ({ tootId, performance, account, checkout })
  const keepTakes = (...takes: ReturnType<typeof takeOf>[]) =>
    localStorage.setItem('pedos.padTakes', JSON.stringify(takes))
  /** userA's take whose Save started a Checkout. */
  const paying = (tootId: string, performance: Performance) =>
    takeOf(tootId, performance, { account: 'userA', checkout: true })
  const lastSave = () => page.saveToToots.mock.lastCall?.[0]
  const lostSays = "Your payment went through, but this take couldn't be made again here."
  /** Saving is paid here, and the account is signed in, with this browser's library its. */
  const signedInWherePaid = () => {
    localStorage.setItem('pedos.account', 'userA')
    page.pulled = 'userA'
    page.paid = true
    page.account = {
      status: 'signedIn',
      id: 'userA',
      email: 'a@example.test',
      marketingEmail: false
    }
  }

  /** Records a take of one tap on Pad 1. */
  async function recordOneTap() {
    await click('pad-take-record')
    await press(1, window.performance.now())
  }

  it('keeps what played from Record to Stop, timed from the first tap, then plays its Toot', async () => {
    await open(Promise.resolve({} as AudioBuffer))
    // Before Record, a press plays and isn't kept.
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
    // Made, it plays once, and Save to Toots saves it.
    expect(page.toggleTootPlayback).toHaveBeenCalledWith(draftOf(played, id))
    expect(lastSave()).toEqual({
      draft: draftOf(played, id),
      back: null,
      keep: expect.any(Function)
    })
    // Kept by its Toot id, for the return from Checkout.
    expect(kept()).toEqual([takeOf(id, played)])
    // Kept again before Checkout, as the paying account's.
    expect(lastSave().keep('userA')).toBe(true)
    expect(kept()).toEqual([takeOf(id, played, { account: 'userA', checkout: true })])

    // A new take keeps the last one too.
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
      // Ready to play with a tap.
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
      // In view again when it's made: only the take the user stopped plays once made.
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
      // The phone goes to Record before the take is made.
      leave()
      await act(async () => made.resolve(draftOf(one, id)))

      await open(Promise.resolve({} as AudioBuffer))
      expect(page.makePadToot).toHaveBeenLastCalledWith(one, id)
      expect(byTestId('pad-toot-state')?.textContent).toBe('Ready')
      expect(lastSave()).toMatchObject({ draft: draftOf(one, id), back: null })
      expect(page.toggleTootPlayback).not.toHaveBeenCalled()
    })
  })

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
      // Saving is free here: nothing asks the account.
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
      // Saved as back from its Checkout.
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
      // Try again makes it.
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
      expect(page.makePadToot).not.toHaveBeenCalled()
      expect(byTestId('pad-take-lost')?.textContent).toContain(lostSays)
      // A known code and nothing else: the paid, unused payment is what's refunded.
      expect(page.reportError).toHaveBeenCalledExactlyOnceWith('pad-paid-take-lost')
      expect(kept()).toEqual([])
      await click('pad-take-record')
      expect(byTestId('pad-take-lost')).toBeNull()
    })

    describe('signed in again, before the account’s changes are read', () => {
      // Sign out cleared this browser's library, and kept the take whose Save started a Checkout;
      // signed in again as the same account, the Pad opens before its Recordings come back.
      beforeEach(() => {
        signedInWherePaid()
        page.pulled = null
        recordings = []
        keepTakes(paying(PAID, one))
        page.tootPaymentState.mockResolvedValue('unused')
      })
      /** The account's changes are read, bringing `brought`. */
      async function pulled(brought: Recording[]) {
        recordings = brought
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
        expect(page.makePadToot).not.toHaveBeenCalled()
        expect(byTestId('pad-take-lost')?.textContent).toContain(lostSays)
        expect(page.reportError).toHaveBeenCalledExactlyOnceWith('pad-paid-take-lost')
        expect(kept()).toEqual([])
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
        // Recorded here since signing in again.
        recordings = [recordingNumbered(B, 2)]
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
      // The kept take is shown again; Record again starts a new one.
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
      expect(page.makePadToot).not.toHaveBeenCalled()
      expect(byTestId('pad-take-lost')?.textContent).toContain(lostSays)
      expect(page.reportError).toHaveBeenCalledExactlyOnceWith('pad-paid-take-lost')
      expect(kept()).toEqual([])
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
