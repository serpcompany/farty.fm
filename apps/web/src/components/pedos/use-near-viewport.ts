'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'

// One observer for every row, so 1,000 rows don't make 1,000 observers.
const watching = new Map<Element, (near: boolean) => void>()
let observer: IntersectionObserver | null = null

/**
 * Whether `ref`'s element is within a screen of the viewport: Compose works out each locked Song's
 * "Needs …" only then (#323), as a Song's Arrangement is the slow part of Pitch Coverage. It turns
 * false again when the element moves further away, so a change to the Recordings while Compose is
 * open only works out the rows near the screen, however far the list was scrolled. A row on screen
 * when it mounts knows before it's painted.
 */
export function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    setNear(isNear(element))
    return watch(element, setNear)
  }, [ref])
  return near
}

function isNear(element: Element): boolean {
  const { top, bottom } = element.getBoundingClientRect()
  const screen = window.innerHeight
  return bottom > -screen && top < 2 * screen
}

function watch(element: Element, near: (near: boolean) => void): () => void {
  observer ??= new IntersectionObserver(
    entries => {
      for (const entry of entries) watching.get(entry.target)?.(entry.isIntersecting)
    },
    { rootMargin: '100% 0px' }
  )
  watching.set(element, near)
  observer.observe(element)
  return () => {
    watching.delete(element)
    observer?.unobserve(element)
  }
}
