import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/lib/catalog/song'
import { songs } from '@/lib/catalog/songs.generated'
import type { FartChoices } from '@/lib/engine/fart-choices'
import { type Coverage, coverageOf } from '@/lib/pitch-coverage'
import type { GoldenRecording } from '@/test-support/golden'
import { goldenAnalysisRecording } from '@/test-support/golden-analysis'
import index from '../../../../../fixtures/golden/index.json'
import r018 from '../../../../../fixtures/golden/recordings/018.json'
import r032 from '../../../../../fixtures/golden/recordings/032.json'
import r090 from '../../../../../fixtures/golden/recordings/090.json'
import { LockedSongSheet } from './locked-song-sheet'
import type { PianoNote } from './piano-preview'

// A locked Song's "Play on piano" (#359) in a DOM: with Melodic Recordings it plays in the key
// Auto-map would play the farts in, the key the sheet's "Needs a fart near …" names; with none it
// plays as written (D6). The coverage is Auto-map's own, from the Fixture Library's golden
// analysis; the piano itself is a spy.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mary = songs.find(s => s.id === 'mary') as Song

const page: { coverage: Coverage; fartChoices: ReadonlyMap<string, FartChoices> } = {
  coverage: coverageOf(mary, []),
  fartChoices: new Map()
}
const playPiano = vi.fn<(notes: readonly PianoNote[]) => void>()

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    coverage: () => page.coverage,
    collectedPitchClasses: new Set<number>(),
    stopPlayback: () => {},
    nowPlaying: null
  })
}))
vi.mock('./use-song-notes', () => ({ useSongNotes: () => ({ song: mary }) }))
vi.mock('./use-fart-choices', () => ({ useFartChoices: () => page.fartChoices }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  )
}))
vi.mock('./favorite-button', () => ({ FavoriteButton: () => null }))
vi.mock('./piano-preview', async importOriginal => ({
  ...(await importOriginal<typeof import('./piano-preview')>()),
  playPiano: (notes: readonly PianoNote[]) => playPiano(notes),
  stopPiano: () => {},
  pianoPosition: () => null
}))

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  playPiano.mockClear()
  page.fartChoices = new Map()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function openAndPlay(coverage: Coverage): Promise<number[]> {
  page.coverage = coverage
  await act(async () =>
    root?.render(
      <LockedSongSheet song={mary} onClose={() => {}} onRecord={() => {}} onReport={() => {}} />
    )
  )
  const button = document.querySelector<HTMLButtonElement>('[data-testid="locked-song-piano"]')
  if (!button) throw new Error('No Play on piano')
  expect(button.textContent).toContain('Play on piano')
  await act(async () => button.click())
  expect(playPiano).toHaveBeenCalledTimes(1)
  return playPiano.mock.calls[0][0].map(note => note.midi)
}

describe('a locked Song the user changed (#372)', () => {
  const changeFarts = () =>
    [...document.querySelectorAll('a')].find(a => a.textContent === 'Change farts')
  const show = () =>
    act(async () =>
      root?.render(
        <LockedSongSheet song={mary} onClose={() => {}} onRecord={() => {}} onReport={() => {}} />
      )
    )

  it('offers its farts from Song Creator, the only way to bring back one left out', async () => {
    page.fartChoices = new Map([[mary.id, { transposition: 0, preferred: {}, excluded: ['a'] }]])
    await show()
    expect(changeFarts()?.getAttribute('href')).toBe(`/compose/${mary.id}/`)
  })

  it('names what Song Creator names, in its key, with no Melodic Recordings left', async () => {
    const choices = { transposition: -5, preferred: {}, excluded: ['a'] }
    page.fartChoices = new Map([[mary.id, choices]])
    page.coverage = coverageOf(mary, [], choices)
    await show()
    expect(document.querySelector('[data-testid="locked-song-needs"]')?.textContent).toMatch(
      /^Needs a fart near /
    )
    expect(await openAndPlay(page.coverage)).toEqual(mary.notes.map(note => note.pitch - 5))
  })

  it('offers nothing new for a Song with no Fart Choices', async () => {
    page.fartChoices = new Map([['twinkle', { transposition: 0, preferred: {}, excluded: ['a'] }]])
    await show()
    expect(changeFarts()).toBeUndefined()
  })
})

// The golden analysis as JSON: this test runs in a DOM, where the golden helpers can't read files.
const fixtures = (goldens: readonly GoldenRecording[]) =>
  goldens.map((golden, i) => goldenAnalysisRecording(golden, i + 1, index.sample_rate))

describe("a locked Song's melody on piano", () => {
  it("plays in Auto-map's key, the one the sheet names, for a user with Melodic Recordings", async () => {
    // The sample story's first three takes leave Mary locked, 1 of 4 notes covered, 28 down.
    const coverage = coverageOf(mary, fixtures([r018, r032, r090] as GoldenRecording[]))
    expect(coverage.hasMelodicRecordings).toBe(true)
    expect(coverage.unlocked).toBe(false)
    expect(coverage.transposition).toBe(-28)

    const struck = await openAndPlay(coverage)

    expect(struck).toEqual(mary.notes.map(note => note.pitch + coverage.transposition))
    // Each note the sheet asks for ("Needs a fart near G♯2 …, A♯2 … and C3 …") is one it plays.
    expect(document.querySelector('[data-testid="locked-song-needs"]')?.textContent).toBe(
      'Needs a fart near G♯2 (1.5 s), A♯2 (0.7 s), and C3 (0.7 s).'
    )
    for (const { midi } of coverage.missing) expect(struck).toContain(midi)
  })

  it('plays as written for a user with no Recordings (D6)', async () => {
    const coverage = coverageOf(mary, [])
    expect(coverage.hasMelodicRecordings).toBe(false)
    // Auto-map still picks a key with no farts (every key ties), which the piano doesn't take.
    expect(coverage.transposition).not.toBe(0)

    const struck = await openAndPlay(coverage)

    expect(struck).toEqual(mary.notes.map(note => note.pitch))
    expect(document.querySelector('[data-testid="locked-song-needs"]')?.textContent).toBe(
      'Record a fart with a clear note to start.'
    )
  })
})
