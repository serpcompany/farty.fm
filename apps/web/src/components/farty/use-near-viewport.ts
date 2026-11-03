'use client'

import { type RefObject, useLayoutEffect, useState } from 'react'

const watching = new Map<Element, (near: boolean) => void>()
let sharedObserver: IntersectionObserver | null = null

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
  sharedObserver ??= new IntersectionObserver(
    entries => {
      for (const entry of entries) watching.get(entry.target)?.(entry.isIntersecting)
    },
    { rootMargin: '100% 0px' }
  )
  watching.set(element, near)
  sharedObserver.observe(element)
  return () => {
    watching.delete(element)
    sharedObserver?.unobserve(element)
  }
}
