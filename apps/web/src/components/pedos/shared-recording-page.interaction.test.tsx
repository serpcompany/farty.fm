import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { play } from '@/lib/audio/player'

// A shared page's Play in a DOM (#441). The player keeps each sound's decode by its key for the
// whole session, and a slug repeats across Handles and kinds, so each page's key has to be its own
// or moving from one link to another plays the first one's audio.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./account-provider', () => ({
  useAccount: () => ({ account: { status: 'signedOut' } })
}))
vi.mock('./get-farty', () => ({ useStartGetFarty: () => () => {} }))
vi.mock('@/lib/audio/player', () => ({
  play: vi.fn(),
  playbackPosition: () => 0,
  stopPlayback: () => {}
}))

let root: Root | null = null
let container: HTMLDivElement

/** The key and sound a tap on Play asks the player for, and what that sound's load fetches. */
async function played(name: string): Promise<{ key: string; fetched: string }> {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(new ArrayBuffer(8)))
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Play ${name}"]`)
  expect(button).not.toBeNull()
  vi.mocked(play).mockClear()
  await act(async () => button?.click())
  const [key, load, , ended] = vi.mocked(play).mock.calls.at(-1) ?? []
  await load?.()
  const fetched = String(fetchSpy.mock.calls.at(-1)?.[0])
  fetchSpy.mockRestore()
  // The sound ends, so the page is back to Play.
  await act(async () => ended?.())
  return { key: key as string, fetched }
}

const recordingOf = (handle: string, slug: string) => ({
  handle,
  slug,
  name: 'Recording 1',
  note: null,
  length: '1.1 s',
  part: { startSeconds: 0, endSeconds: 1.1 },
  levels: [0.5],
  recordedAt: 0
})

const tootOf = (handle: string, slug: string) => ({
  handle,
  slug,
  title: 'Recording 1',
  song: null,
  length: '0:18',
  seconds: 18,
  levels: [0.5],
  parts: { song: null, catalogSong: null, transposition: 0, lanes: false, rows: [] }
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
})

describe("A shared page's Play", () => {
  it('plays under a key of its own for two Handles with the same slug, on a move between them', async () => {
    const { SharedRecordingPage } = await import('./shared-recording-page')
    await act(async () =>
      root?.render(<SharedRecordingPage {...recordingOf('alice', 'recording-1')} />)
    )
    const alice = await played('Recording 1')
    expect(alice.fetched).toBe('/@alice/r/recording-1/audio/')

    // The same page, moved to in the browser: React keeps it, as Next's router does.
    await act(async () =>
      root?.render(<SharedRecordingPage {...recordingOf('bob', 'recording-1')} />)
    )
    const bob = await played('Recording 1')
    expect(bob.fetched).toBe('/@bob/r/recording-1/audio/')

    expect(bob.key).not.toBe(alice.key)
  })

  it("plays a Recording and a Toot with the same slug under a key each, each its own link's", async () => {
    const { SharedRecordingPage, SharedTootPage } = await import('./shared-recording-page')
    await act(async () =>
      root?.render(<SharedRecordingPage {...recordingOf('alice', 'recording-1')} />)
    )
    const recording = await played('Recording 1')
    await act(async () => root?.render(<SharedTootPage {...tootOf('alice', 'recording-1')} />))
    const toot = await played('Recording 1')

    expect(toot.fetched).toBe('/@alice/t/recording-1/audio/')
    expect(toot.key).not.toBe(recording.key)
  })
})
