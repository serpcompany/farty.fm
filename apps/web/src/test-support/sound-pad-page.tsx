import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, vi } from 'vitest'
import type { Account } from '@/lib/account'
import type { Performance } from '@/lib/performance'
import type { Recording } from '@/lib/recordings'
import type { PadTootDraft, TootDraft } from '@/lib/toot'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

export const page = {
  loadPadSound: vi.fn(),
  playPadSound: vi.fn(),
  reportError: vi.fn(),
  makePadToot: vi.fn(),
  toggleTootPlayback: vi.fn(),
  stopPlayback: vi.fn(),
  forgetToot: vi.fn(),
  saveToToots: vi.fn(),
  tootPaymentState: vi.fn(),
  paid: false,
  account: { status: 'signedOut' } as Account,
  pulled: null as string | null,
  onPulled: new Set<() => void>(),
  saved: new Set<string>(),
  recordings: [] as Recording[]
}

export const recordingNumbered = (id: string, number: number): Recording => ({
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

export const A = '00000000-0000-4000-8000-00000000000a'
export const B = '00000000-0000-4000-8000-00000000000b'
export const recording = recordingNumbered(A, 1)
export const ID = '11111111-1111-4111-8111-111111111111'
export const PAID = '22222222-2222-4222-8222-222222222222'
export const USED = '33333333-3333-4333-8333-333333333333'

export function mockSoundPadPage(): void {
  vi.doMock('@/components/farty/recordings-provider', () => ({
    useRecordings: () => {
      const list = page.recordings
      return {
        recordings: list,
        recording: (id: string) => list.find(r => r.id === id),
        makePadToot: page.makePadToot
      }
    }
  }))
  vi.doMock('@/components/farty/toots-provider', () => ({
    useToots: () => ({
      toots: [],
      toot: (id: string) => (page.saved.has(id) ? {} : undefined),
      toggleTootPlayback: page.toggleTootPlayback,
      forgetToot: page.forgetToot,
      tootPlayFailed: null
    }),
    tootPlayback: (id: string) => `toot:${id}`
  }))
  vi.doMock('@/components/farty/playback-provider', () => ({
    usePlayback: () => ({ nowPlaying: null })
  }))
  vi.doMock('@/lib/audio/player', () => ({ stopPlayback: page.stopPlayback }))
  vi.doMock('@/components/farty/account-provider', () => ({
    useAccount: () => ({ account: page.account })
  }))
  vi.doMock('@/lib/toot-payment', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/toot-payment')>()),
    saveAsksForPayment: () => page.paid,
    tootPaymentState: page.tootPaymentState
  }))
  vi.doMock('@/components/farty/save-to-toots', () => ({
    SaveToToots: (props: {
      draft: TootDraft
      back: unknown
      keep?: (accountId: string) => boolean
    }) => {
      page.saveToToots(props)
      return <button type="button">Save to Toots</button>
    }
  }))
  vi.doMock('@/lib/audio/pad-player', async importOriginal => ({
    PadAudioUnavailable: (await importOriginal<typeof import('@/lib/audio/pad-player')>())
      .PadAudioUnavailable,
    loadPadSound: page.loadPadSound,
    playPadSound: page.playPadSound,
    keepPadSounds: () => undefined,
    stopPadSounds: () => undefined
  }))
  vi.doMock('@/lib/audio/context', () => ({ startAudioInTap: () => undefined }))
  vi.doMock('@/lib/pad-store', () => ({
    loadPads: async () => new Map(),
    savePads: async () => undefined
  }))
  vi.doMock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
  vi.doMock('@/lib/recording-store', () => ({ loadAudio: () => new Promise(() => undefined) }))
  vi.doMock('@/lib/library-sync', () => ({
    libraryPulled: () => page.pulled,
    onLibraryPulled: (listener: () => void) => {
      page.onPulled.add(listener)
      return () => page.onPulled.delete(listener)
    }
  }))
  vi.doMock('@/lib/telemetry/errors', () => ({ reportError: page.reportError }))
  vi.doMock('next/navigation', () => ({ useRouter: () => ({}) }))

  beforeEach(() => {
    vi.clearAllMocks()
    page.paid = false
    page.account = { status: 'signedOut' }
    page.pulled = null
    page.saved = new Set()
    page.recordings = [recording]
  })

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    leave()
    localStorage.clear()
    window.history.replaceState(null, '', '/compose/pad/')
  })
}

let root: Root | null = null

export async function open(sound: Promise<unknown>) {
  const { SoundPad } = await import('@/components/farty/sound-pad')
  page.loadPadSound.mockReturnValue(sound)
  sound.catch(() => undefined)
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<SoundPad />))
}

export function leave() {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
}

export const pad = (number = 1) => {
  const found = document.querySelector<HTMLButtonElement>(`[data-pad="${number}"]`)
  if (!found) throw new Error(`no Pad ${number}`)
  return found
}

export async function press(number = 1, at?: number) {
  const event = new PointerEvent('pointerdown', { bubbles: true, button: 0 })
  if (at !== undefined) Object.defineProperty(event, 'timeStamp', { value: at })
  await act(async () => {
    pad(number).dispatchEvent(event)
  })
}

export const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

export async function click(id: string) {
  const button = byTestId(id)
  if (!button) throw new Error(`no ${id}`)
  await act(async () => button.click())
}

export function later<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

export async function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

export const draftOf = (performance: Performance, id = ID): PadTootDraft => ({
  id,
  song: null,
  performance,
  seconds: 1.2,
  wav: new ArrayBuffer(0)
})

export const one: Performance = { recordings: [A], taps: [[0, 0]] }

export const ofDeleted: Performance = {
  recordings: ['00000000-0000-4000-8000-00000000000f'],
  taps: [[0, 0]]
}

export const kept = () => JSON.parse(localStorage.getItem('pedos.padTakes') ?? '[]')

export const takeOf = (
  tootId: string,
  performance: Performance,
  { account = null as string | null, checkout = false } = {}
) => ({ tootId, performance, account, checkout })

export const keepTakes = (...takes: ReturnType<typeof takeOf>[]) =>
  localStorage.setItem('pedos.padTakes', JSON.stringify(takes))

export const paying = (tootId: string, performance: Performance) =>
  takeOf(tootId, performance, { account: 'userA', checkout: true })

export const lastSave = () => page.saveToToots.mock.lastCall?.[0]

export const lostSays = "Your payment went through, but this take couldn't be made again here."

export function signedInWherePaid() {
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

export function withTwoRecordings() {
  beforeEach(() => {
    page.recordings = [recording, recordingNumbered(B, 2)]
    page.makePadToot.mockImplementation(async (performance: Performance, id: string) =>
      draftOf(performance, id)
    )
  })
}

export async function recordOneTap() {
  await click('pad-take-record')
  await press(1, window.performance.now())
}
