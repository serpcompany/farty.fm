import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedFartRow, SharedTootParts } from '@/lib/toot'

// A shared Toot's page in a DOM, signed out (#443): the roll and each fart under its player, one
// sound at a time. The player is a fake that records what it's asked to play.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const heard = vi.hoisted(() => ({
  plays: [] as {
    key: string
    wav: () => Promise<ArrayBuffer>
    segment: { start: number; end: number } | null
    onEnded: () => void
  }[],
  stops: 0
}))
const catalog = vi.hoisted(() => ({ loadSong: vi.fn() }))

vi.mock('@/lib/audio/player', () => ({
  play: async (
    key: string,
    wav: () => Promise<ArrayBuffer>,
    segment: { start: number; end: number } | null,
    onEnded: () => void
  ) => {
    heard.plays.push({ key, wav, segment, onEnded })
  },
  playbackPosition: () => null,
  stopPlayback: () => {
    heard.stops += 1
    heard.plays.at(-1)?.onEnded()
  }
}))
vi.mock('@/lib/catalog/load-songs', () => catalog)
vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedOut' } })
}))
vi.mock('./get-farty', () => ({ useStartGetFarty: () => () => {} }))
vi.mock('./site-chrome', () => ({ SiteHeader: () => null }))

const fart = (place: number, name: string): SharedFartRow['fart'] => ({
  place,
  name,
  length: '0:01',
  levels: [0.2, 0.8],
  recordedAt: Date.UTC(2026, 10, 6, 15, 12),
  playable: true,
  recordedIn: 'Austin, Texas',
  timeZone: 'America/Chicago'
})

const notes = [
  { start: 0, dur: 2, pitch: 60 },
  { start: 2, dur: 2, pitch: 64 }
]
const song = { bpm: 60, length_beats: 4, notes, pitches: [60, 64] }
const rows: SharedFartRow[] = [
  { plays: 'C4', pitch: 60, colorIndex: 0, fart: fart(0, 'Big one') },
  { plays: 'E4', pitch: 64, colorIndex: 1, fart: fart(1, 'Small one') }
]
const parts: SharedTootParts = {
  song,
  catalogSong: null,
  transposition: 0,
  lanes: false,
  rows
}

const BASE = '/@alice/t/song/'

let root: Root | null = null
let container: HTMLDivElement

async function render(toot: SharedTootParts = parts) {
  const { SharedTootPage } = await import('./shared-recording-page')
  await act(async () =>
    root?.render(
      <SharedTootPage
        handle="alice"
        slug="song"
        title="Song"
        song="Song"
        length="0:04"
        seconds={4}
        parts={toot}
      />
    )
  )
}

const byTestId = (id: string) => [...container.querySelectorAll(`[data-testid="${id}"]`)]
const fartRows = () => byTestId('recording-used')
const fartButton = (index: number) => fartRows()[index].querySelector('button') as HTMLElement
const labelled = (label: string) => container.querySelector(`button[aria-label="${label}"]`)
const click = (element: Element | null) => act(async () => (element as HTMLElement | null)?.click())

beforeEach(() => {
  heard.plays.length = 0
  heard.stops = 0
  catalog.loadSong.mockReset()
  // The playhead moves each frame, which `act` would wait on for good.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("A shared Toot's farts", () => {
  it('lists each fart, with its note and when it was recorded', async () => {
    await render()
    expect(fartRows()).toHaveLength(2)
    expect(fartRows()[0].textContent).toContain('Big one')
    expect(fartRows()[0].textContent).toContain('plays C4')
    expect(fartRows()[0].textContent).toContain('2026')
    expect(byTestId('note-view')).toHaveLength(1)
  })

  it('plays one alone from its own audio, and stops it, leaving the Toot unplayed', async () => {
    const fetched = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new ArrayBuffer(8)))
    await render()

    await click(fartButton(1))
    expect(heard.plays).toHaveLength(1)
    expect(heard.plays[0].key).toBe(`shared:${BASE}farts/1/audio/`)
    expect(heard.plays[0].segment).toBeNull()
    await heard.plays[0].wav()
    expect(fetched).toHaveBeenCalledWith(`${BASE}farts/1/audio/`)
    expect(fartButton(1).getAttribute('aria-pressed')).toBe('true')
    expect(fartButton(0).getAttribute('aria-pressed')).toBe('false')
    // The Toot's own Play isn't what's playing.
    expect(labelled('Play Song')).not.toBeNull()

    await click(fartButton(1))
    expect(heard.stops).toBeGreaterThan(0)
    expect(heard.plays).toHaveLength(1)
    expect(fartButton(1).getAttribute('aria-pressed')).toBe('false')
  })

  it('says so when a fart will not play', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 404 })
    )
    await render()
    await click(fartButton(0))
    await act(async () => {
      await expect(heard.plays[0].wav()).rejects.toThrow('audio 404')
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't play it")
  })

  it('shows a deleted Recording with its note and nothing to play', async () => {
    await render({ ...parts, rows: [{ ...rows[0], fart: null }, rows[1]] })
    expect(fartRows()[0].textContent).toContain('Recording deleted')
    expect(fartRows()[0].textContent).toContain('plays C4')
    expect(fartRows()[0].querySelector('button')).toBeNull()
  })

  it('says where each fart was made, in the time there', async () => {
    await render()
    expect(fartRows()[0].textContent).toContain('Austin, Texas')
    // 15:12 UTC, in Chicago that November.
    expect(fartRows()[0].textContent).toMatch(/\b0?9:12/)
  })

  it('says nothing of where for a fart with no place', async () => {
    await render({
      ...parts,
      rows: rows.map(row => ({
        ...row,
        fart: row.fart && { ...row.fart, recordedIn: null, timeZone: null }
      }))
    })
    expect(fartRows()[0].textContent).toContain('2026')
    expect(fartRows()[0].textContent).not.toContain('Austin')
  })

  it("has nothing to play on a fart analysis hasn't found", async () => {
    const found = fart(0, 'New one')
    const notFound = found && { ...found, length: '', levels: [], playable: false }
    await render({ ...parts, rows: [{ ...rows[0], fart: notFound }] })

    expect((fartButton(0) as HTMLButtonElement).disabled).toBe(true)
    await click(fartButton(0))
    expect(heard.plays).toEqual([])
  })

  it('leaves out the note on a Sound Pad fart, which played none', async () => {
    await render({
      ...parts,
      lanes: true,
      rows: [{ plays: null, pitch: 60, colorIndex: 0, fart: fart(0, 'Big one') }]
    })
    expect(fartRows()[0].textContent).not.toContain('plays')
  })
})

describe("A shared Toot's page is the screen it was made on (#451)", () => {
  it("has Song Creator's Play, state and line, then the whole roll, then Recordings used", async () => {
    await render()
    expect(byTestId('shared-toot-state')[0].textContent).toBe('Ready')
    expect(container.textContent).toContain("0:04 · 2 of @alice's Recordings, one per note")
    const roll = byTestId('note-view')[0]
    const used = container.querySelector('#recordings-used')
    expect(used?.textContent).toBe('Recordings used')
    expect(
      roll.compareDocumentPosition(used as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // The roll stands for the Toot: no waveform of the whole Toot to scrub.
    expect(container.querySelector('[aria-label="Play Song from a spot"]')).toBeNull()

    await click(byTestId('shared-toot-play')[0])
    expect(byTestId('shared-toot-state')[0].textContent).toBe('Playing')
    expect(byTestId('shared-toot-play')[0].getAttribute('aria-label')).toBe('Stop Song')
  })

  it("leaves out 'one per note' for a Sound Pad Toot, whose farts aren't one per note", async () => {
    await render({ ...parts, lanes: true })
    expect(container.textContent).toContain("0:04 · 2 of @alice's Recordings")
    expect(container.textContent).not.toContain('one per note')
  })
})

describe("A shared Toot's roll", () => {
  it("plays the whole Toot from its Play, and shows that one note's part when tapped", async () => {
    await render()
    await click(labelled('Play Song'))
    expect(heard.plays.at(-1)?.key).toBe(`shared:${BASE}audio/`)
    expect(heard.plays.at(-1)?.segment).toEqual({ start: 0, end: 4 })
    expect(labelled('Stop Song')).not.toBeNull()

    await click(byTestId('note 2')[0])
    expect(heard.plays.at(-1)?.key).toBe(`shared:${BASE}audio/`)
    expect(heard.plays.at(-1)?.segment).toEqual({ start: 2, end: 4 })
    // Tapped again, it stops.
    await click(byTestId('note 2')[0])
    expect(heard.stops).toBeGreaterThan(0)
    expect(labelled('Play Song')).not.toBeNull()
  })

  it('fetches its Song’s notes when the Toot saved none', async () => {
    catalog.loadSong.mockResolvedValue(song)
    const summary = { id: 'twinkle', notesPath: '/notes.json', pitches: [60, 64] }
    await render({
      ...parts,
      song: null,
      catalogSong: summary as unknown as SharedTootParts['catalogSong']
    })
    expect(catalog.loadSong).toHaveBeenCalledWith(summary)
    expect(byTestId('note-view')).toHaveLength(1)
  })

  it('does without the roll when those can’t be fetched, and keeps the farts', async () => {
    catalog.loadSong.mockRejectedValue(new Error('offline'))
    await render({
      ...parts,
      song: null,
      catalogSong: { id: 'twinkle' } as unknown as SharedTootParts['catalogSong']
    })
    expect(byTestId('note-view')).toHaveLength(0)
    expect(fartRows()).toHaveLength(2)
  })

  it('has none when its Song is gone', async () => {
    await render({ ...parts, song: null })
    expect(byTestId('note-view')).toHaveLength(0)
    expect(catalog.loadSong).not.toHaveBeenCalled()
  })
})
