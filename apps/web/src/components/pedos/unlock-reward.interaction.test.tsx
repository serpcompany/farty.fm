import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SongSummary } from '@/lib/catalog/song'
import { songIndex } from '@/lib/catalog/song-index.generated'
import type { CoverageChanges, Unlock } from '@/lib/pitch-coverage'
import type { Recording } from '@/lib/recordings'
import { RecordFlow } from './record-flow'
import { countAt, shownAtFirst, UnlockReward } from './unlock-reward'

// The Result's reward when a save unlocks Songs (#363) in a DOM: up to 4 Songs show, else the
// first 3 and See all, which lists the rest and moves focus to the 4th; a row and Try it open the
// reward's first Songs in Song Creator; the count counts up to the total once, or with reduced
// motion reads it at once. Nothing here plays a sound.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const page = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  startAudioInTap: vi.fn(),
  flow: null as unknown
}))

vi.mock('@/lib/audio/context', () => ({ startAudioInTap: page.startAudioInTap }))
vi.mock('@/lib/favorite-store', () => ({
  loadFavorites: async () => [],
  onFavoritesChanged: () => () => {},
  setFavorite: async () => {}
}))
vi.mock('@/lib/visit', () => ({ openVisit: () => ({ library: Promise.resolve() }) }))
vi.mock('@/lib/library-sync', () => ({ onLibraryChanged: () => () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: page.push }),
  usePathname: () => '/'
}))
vi.mock('./account-provider', () => ({
  useAccount: () => ({ offerStep: (go: () => void) => go() })
}))
vi.mock('./share-recording', () => ({ ShareRecordingButton: () => null }))
vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    flow: page.flow,
    capture: { kind: 'idle' },
    recording: (id: string) => (id === recording.id ? recording : undefined),
    collectedPitchClasses: new Set<number>(),
    melodicRecordings: [],
    finishFlow: () => {}
  })
}))

const recording: Recording = {
  id: 'take',
  number: 1,
  createdAt: 0,
  seconds: 1,
  sampleRate: 48_000,
  waveform: [],
  analysis: { state: 'notAnalyzed' }
}

/** `count` of the catalog's Songs, unlocked from 1 note short of each. */
const unlocks = (count: number): Unlock[] =>
  songIndex.slice(0, count).map(song => {
    const total = new Set(song.pitches.map(p => Math.round(p) % 12)).size
    return {
      song,
      before: { covered: total - 1, total, hasMelodicRecordings: true, unlocked: false }
    }
  })

let container: HTMLDivElement
let root: Root | null = null
let reducedMotion = false

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  reducedMotion = false
  vi.spyOn(window, 'matchMedia').mockImplementation(
    query =>
      ({
        matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
        addEventListener: () => {},
        removeEventListener: () => {}
      }) as unknown as MediaQueryList
  )
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  page.flow = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  page.push.mockReset()
  page.startAudioInTap.mockReset()
})

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise(r => setTimeout(r, 0)))
}

async function reward(count: number, onOpen: (song: SongSummary) => void = () => {}) {
  await act(async () => root?.render(<UnlockReward unlocked={unlocks(count)} onOpen={onOpen} />))
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="song-row"]')]
const shownSongs = () => rows().map(row => row.dataset.song)
const seeAll = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.startsWith('See all')
  )
const count = () => document.querySelector('[data-testid="unlock-count"]')?.textContent
const unlocking = () => rows().filter(row => row.style.getPropertyValue('--d') !== '')

describe('The unlock reward', () => {
  it('shows up to 4 Songs in full, and from 5 the first 3 and See all', async () => {
    expect([1, 2, 3, 4, 5, 6, 77].map(shownAtFirst)).toEqual([1, 2, 3, 4, 3, 3, 3])
    for (const [n, shown] of [
      [1, 1],
      [4, 4],
      [5, 3],
      [77, 3]
    ]) {
      await reward(n)
      expect(shownSongs(), `${n} Songs`).toEqual(unlocks(shown).map(u => u.song.id))
      expect(unlocking(), `${n} Songs`).toHaveLength(shown)
      expect(seeAll()?.textContent, `${n} Songs`).toBe(n > 4 ? `See all ${n} Songs` : undefined)
      expect(seeAll()?.getAttribute('aria-expanded') ?? 'false').toBe('false')
      // Read as one sentence; the count and its words are only shown.
      expect(document.querySelector('.sr-only')?.textContent).toBe(
        n === 1 ? '1 Song unlocked' : `${n} Songs unlocked`
      )
      await act(async () => root?.unmount())
      root = createRoot(container)
    }
  })

  it('lists every Song on See all, the rest already open, and moves focus to the 4th', async () => {
    await reward(77)
    const button = seeAll()
    await act(async () => button?.click())
    expect(shownSongs()).toEqual(unlocks(77).map(u => u.song.id))
    expect(seeAll()).toBeUndefined()
    // Only the first 3 open their locks; the rest show unlocked, with no lock and no animation.
    expect(unlocking().map(row => row.dataset.song)).toEqual(unlocks(3).map(u => u.song.id))
    expect(rows()[3].querySelector('.motion-safe\\:animate-unlock-lock')).toBeNull()
    expect(document.activeElement).toBe(rows()[3].querySelector('a'))
  })

  it('opens a row’s Song with the tap that starts the sound', async () => {
    const onOpen = vi.fn()
    await reward(3, onOpen)
    const link = rows()[1].querySelector('a')
    // next/link drops the trailing slash outside a Next build, which adds it back (trailingSlash).
    expect(link?.getAttribute('href')).toBe(`/compose/${unlocks(3)[1].song.id}`)
    await act(async () => link?.click())
    expect(onOpen).toHaveBeenCalledWith(unlocks(3)[1].song)
    expect(page.startAudioInTap).toHaveBeenCalledOnce()
  })

  it('counts up as the locks open, then rolls to the total, once', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    await reward(77)
    expect(count()).toBe('0')
    await act(async () => vi.advanceTimersByTime(800))
    expect(count()).toBe('2')
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(count()).toBe('77')
    // See all doesn't count again.
    await act(async () => seeAll()?.click())
    await act(async () => vi.advanceTimersByTime(100))
    expect(count()).toBe('77')
  })

  it('shows the last frame at once with reduced motion', async () => {
    reducedMotion = true
    await act(async () => root?.render(<UnlockReward unlocked={unlocks(77)} onOpen={() => {}} />))
    expect(count()).toBe('77')
    expect(shownSongs()).toHaveLength(3)
  })

  it('times the count from when the Result shows', () => {
    // One Song: its lock opens 420 ms in.
    expect([0, 419, 420, 5_000].map(t => countAt(t, 1))).toEqual([0, 0, 1, 1])
    // 3 Songs: 300 ms apart.
    expect([419, 420, 720, 1_020].map(t => countAt(t, 3))).toEqual([0, 1, 2, 3])
    // 77 Songs: 3 open, then 120 ms later the count rolls to 77 over 500 ms, easing out.
    expect([1_020, 1_140, 1_390, 1_640, 9_000].map(t => countAt(t, 77))).toEqual([3, 3, 68, 77, 77])
    expect(countAt(1_640, 5)).toBe(5)
  })
})

describe('The Result after an unlock', () => {
  const changes = (count: number): CoverageChanges => ({
    unlocked: unlocks(count),
    improved: [],
    closest: null
  })

  async function result(count: number) {
    page.flow = { kind: 'result', id: recording.id, changes: changes(count) }
    await act(async () => root?.render(<RecordFlow />))
    await settle()
  }

  const button = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      b => b.textContent?.trim() === name
    )

  it('opens the reward’s first Song on Try it', async () => {
    await result(5)
    expect(document.querySelector('[data-testid="unlock-reward"]')).not.toBeNull()
    await act(async () => button('Try it')?.click())
    expect(page.push).toHaveBeenCalledWith(`/compose/${unlocks(5)[0].song.id}/`)
    expect(page.startAudioInTap).toHaveBeenCalledOnce()
  })

  it('opens a row’s Song in Song Creator', async () => {
    await result(2)
    await act(async () => rows()[1].querySelector('a')?.click())
    expect(page.push).toHaveBeenCalledWith(`/compose/${unlocks(2)[1].song.id}/`)
  })
})
