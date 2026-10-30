import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Trim } from '@/lib/recordings'
import { ReplayWaveform } from './waveform'

// A replay's waveform in a DOM (#293): the playhead follows the audio clock while it plays, a tap
// plays from that spot, a drag scrubs and plays from where it lets go, and the arrow keys jump.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** A 2 s view, drawn 200 px wide from x = 0: a pixel is a hundredth of a second. */
const view: Trim = { startSeconds: 1, endSeconds: 3 }
const levels = Array(48).fill(0.5)

let root: Root | null = null
let clock: number | null = null
const onPlayFrom = vi.fn()
const onScrubStart = vi.fn()

beforeEach(() => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  clock = null
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
})

const onTrim = vi.fn()

async function draw(playing: Trim | null, trim?: Trim) {
  await act(async () =>
    root?.render(
      <ReplayWaveform
        levels={levels}
        view={view}
        playing={playing}
        position={() => clock}
        label="Play Recording 3 from a spot"
        onPlayFrom={onPlayFrom}
        onScrubStart={onScrubStart}
        trim={trim && { part: trim, onChange: onTrim }}
      />
    )
  )
  const slider = document.querySelector<HTMLElement>('[data-testid="replay-waveform"]')
  if (!slider) throw new Error('no slider')
  slider.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
  return slider
}

const waveform = () => document.querySelector('[data-testid="replay-waveform"]') as HTMLElement
const playhead = () => document.querySelector<HTMLElement>('[data-testid="playhead"]')
const filled = () => document.querySelectorAll('.bg-primary').length

async function pointer(target: HTMLElement, type: string, clientX: number, pointerType = 'mouse') {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { clientX, button: 0, bubbles: true, pointerType }))
  })
}

async function frame() {
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

it('is a slider named for its Recording, with no playhead until it plays', async () => {
  const slider = await draw(null)
  expect(slider.getAttribute('aria-label')).toBe('Play Recording 3 from a spot')
  expect(slider.getAttribute('aria-valuemin')).toBe('1')
  expect(slider.getAttribute('aria-valuemax')).toBe('3')
  expect(slider.getAttribute('aria-valuetext')).toBe('1.00 s')
  expect(playhead()).toBeNull()
  expect(filled()).toBe(0)
})

it('moves its playhead with the audio clock, filling the bars it has passed', async () => {
  clock = 1.51
  await draw({ startSeconds: 1, endSeconds: 3 })
  await frame()
  expect(playhead()?.style.left).toBe('25.500%')
  // A screen reader hears where it plays.
  expect(waveform().getAttribute('aria-valuetext')).toBe('1.51 s')
  // The bar the line is in fills as it enters.
  expect(filled()).toBe(13)

  clock = 2.01
  await frame()
  expect(playhead()?.style.left).toBe('50.500%')
  expect(filled()).toBe(25)
})

it('plays from the spot a tap lands on', async () => {
  const slider = await draw(null)
  await pointer(slider, 'pointerdown', 50)
  await pointer(slider, 'pointerup', 52)
  expect(onScrubStart).not.toHaveBeenCalled()
  expect(onPlayFrom).toHaveBeenCalledWith(1.52)
})

it('scrubs while dragged, then plays from where it lets go', async () => {
  const slider = await draw(null)
  await pointer(slider, 'pointerdown', 20)
  await pointer(slider, 'pointermove', 100)
  expect(onScrubStart).toHaveBeenCalledOnce()
  expect(playhead()?.style.left).toBe('50.000%')
  // Scrubbing shows where it is, but fills nothing in.
  expect(filled()).toBe(0)
  expect(onPlayFrom).not.toHaveBeenCalled()

  await pointer(slider, 'pointerup', 150)
  expect(onPlayFrom).toHaveBeenCalledWith(2.5)
  expect(playhead()).toBeNull()
})

it('jumps a twelfth of the view with the arrow keys', async () => {
  const slider = await draw(null)
  await act(async () => {
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  expect(onPlayFrom.mock.calls[0][0]).toBeCloseTo(1 + 2 / 12)
})

it('stops scrubbing without playing when the browser takes the touch for a scroll', async () => {
  // A vertical pan over a `touch-pan-y` row sends pointercancel, not pointerup.
  const slider = await draw(null)
  await pointer(slider, 'pointerdown', 20, 'touch')
  await pointer(slider, 'pointermove', 100, 'touch')
  expect(playhead()?.style.left).toBe('50.000%')

  await pointer(slider, 'pointercancel', 100, 'touch')
  expect(playhead()).toBeNull()
  expect(onPlayFrom).not.toHaveBeenCalled()
  // Nothing is left listening: a later lift plays nothing.
  await pointer(slider, 'pointerup', 150, 'touch')
  expect(onPlayFrom).not.toHaveBeenCalled()
})

it("puts the Trim's handles beside the slider, each its own slider with arrow keys", async () => {
  const slider = await draw(null, { startSeconds: 1.5, endSeconds: 2.5 })
  const handles = [...document.querySelectorAll<HTMLElement>('[data-handle]')]
  expect(handles.map(handle => handle.getAttribute('aria-label'))).toEqual([
    'Where the fart starts',
    'Where the fart ends'
  ])
  for (const handle of handles) {
    expect(handle.getAttribute('role')).toBe('slider')
    // A slider's children are presentational, so a handle is never inside the waveform's.
    expect(slider.contains(handle)).toBe(false)
  }
  expect(handles[1].getAttribute('aria-valuetext')).toBe('2.50 s')

  await act(async () => {
    handles[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
    )
  })
  expect(onTrim).toHaveBeenCalledWith({ startSeconds: 1.5, endSeconds: 2.4 }, true)
  // The key moves the handle, not the play position.
  expect(onPlayFrom).not.toHaveBeenCalled()
})
