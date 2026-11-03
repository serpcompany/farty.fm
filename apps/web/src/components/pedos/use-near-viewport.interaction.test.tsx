import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNearViewport } from './use-near-viewport'

// Compose works out a locked Song's Needs only while its row is near the screen (#323). A row
// scrolled past stops, so a change to the Recordings after a full scroll works out only the rows
// near the screen again, not every row ever seen.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let report: IntersectionObserverCallback = () => undefined
const observed = new Set<Element>()

class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    report = callback
  }
  observe(element: Element) {
    observed.add(element)
  }
  unobserve(element: Element) {
    observed.delete(element)
  }
  disconnect() {}
}

/** Reports `element` within the observer's margin, or not. */
function scroll(element: Element, isIntersecting: boolean) {
  act(() =>
    report(
      [{ target: element, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  )
}

const workedOut = vi.fn<(id: string) => void>()

function Row({ id, version }: { id: string; version: number }) {
  const ref = useRef<HTMLLIElement>(null)
  const near = useNearViewport(ref)
  if (near) workedOut(`${id}@${version}`)
  return <li ref={ref} data-row={id} data-near={near} />
}

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  workedOut.mockClear()
})

const render = (version: number) =>
  act(() =>
    root?.render(
      <ul>
        {['a', 'b', 'c'].map(id => (
          <Row key={id} id={id} version={version} />
        ))}
      </ul>
    )
  )
const row = (id: string) => container.querySelector(`[data-row="${id}"]`) as Element

it('turns false when the row moves away, and true when it comes back', () => {
  render(1)
  // happy-dom lays nothing out, so every row starts on the screen.
  expect(row('a').getAttribute('data-near')).toBe('true')
  scroll(row('a'), false)
  expect(row('a').getAttribute('data-near')).toBe('false')
  scroll(row('a'), true)
  expect(row('a').getAttribute('data-near')).toBe('true')
})

it('works out only the rows near the screen when the Recordings change after a full scroll', () => {
  render(1)
  scroll(row('a'), false)
  scroll(row('b'), false)
  workedOut.mockClear()
  render(2)
  expect(workedOut.mock.calls.map(([id]) => id)).toEqual(['c@2'])
})

it('stops watching a row once it unmounts', () => {
  render(1)
  expect(observed.size).toBe(3)
  act(() => root?.render(<ul />))
  expect(observed.size).toBe(0)
})
