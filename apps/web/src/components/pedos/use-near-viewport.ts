'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'

// One observer for every row that waits, so 1,000 rows don't make 1,000 observers.
const waiting = new Map<Element, () => void>()
let observer: IntersectionObserver | null = null

/**
 * Whether `ref`'s element has come within a screen of the viewport, and stays true once it has:
 * Compose works out each locked Song's "Needs …" only then (#323), as a Song's Arrangement is the
 * slow part of Pitch Coverage. A row on screen when it mounts knows before it's painted.
 */
export function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (near || !element) return
    if (typeof IntersectionObserver === 'undefined' || isNear(element)) {
      setNear(true)
      return
    }
    return watch(element, () => setNear(true))
  }, [ref, near])
  return near
}

function isNear(element: Element): boolean {
  const { top, bottom } = element.getBoundingClientRect()
  const screen = window.innerHeight
  return bottom > -screen && top < 2 * screen
}

function watch(element: Element, near: () => void): () => void {
  observer ??= new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        waiting.get(entry.target)?.()
        unwatch(entry.target)
      }
    },
    { rootMargin: '100% 0px' }
  )
  waiting.set(element, near)
  observer.observe(element)
  return () => unwatch(element)
}

function unwatch(element: Element) {
  waiting.delete(element)
  observer?.unobserve(element)
}
