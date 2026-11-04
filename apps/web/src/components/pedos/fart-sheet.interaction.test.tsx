import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FartSheet } from '@/lib/fart-sheet'
import { FartSheetView } from './fart-sheet'
import type { PianoNote } from './piano-preview'

// The fart sheet's "Hear <pitch> on piano" (#373) in a DOM: it plays the sheet's note on piano, and
// closing the sheet stops it (so does every pick, leave-out and reset, which close it). The piano
// itself is a spy.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const playPiano = vi.fn<(notes: readonly PianoNote[]) => void>()
const stopPiano = vi.fn()

vi.mock('./pedos-provider', () => ({
  usePedos: () => ({
    recording: () => undefined,
    stopPlayback: () => {},
    togglePlayback: () => {},
    nowPlaying: null
  })
}))
vi.mock('./piano-preview', async importOriginal => ({
  ...(await importOriginal<typeof import('./piano-preview')>()),
  playPiano: (notes: readonly PianoNote[]) => playPiano(notes),
  stopPiano: () => stopPiano(),
  pianoPosition: () => null
}))

/** C♯3, which three of the Song's notes sound at. */
const sheet: FartSheet = {
  songPitch: 61,
  note: 49,
  noteCount: 3,
  inUse: null,
  free: [],
  others: [],
  leftOut: [],
  neededSeconds: 0.5,
  isOnlyFart: false,
  hasChange: false
}

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  playPiano.mockClear()
  stopPiano.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const render = (shown: FartSheet | null) =>
  act(async () =>
    root?.render(<FartSheetView sheet={shown} onClose={() => {}} onChange={() => {}} />)
  )

const hearButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.includes('on piano')
  )

describe('the fart sheet on piano', () => {
  it("plays the sheet's pitch, named on the button", async () => {
    await render(sheet)
    const button = hearButton()
    expect(button?.textContent).toBe('Hear C♯3 on piano')

    await act(async () => button?.click())

    expect(playPiano).toHaveBeenCalledTimes(1)
    expect(playPiano.mock.calls[0][0]).toEqual([{ midi: 49, start: 0, seconds: 2 }])
  })

  it('stops when the sheet closes, and not while it is open', async () => {
    await render(sheet)
    await render(sheet)
    expect(stopPiano).not.toHaveBeenCalled()

    await render(null)

    expect(stopPiano).toHaveBeenCalled()
  })
})
