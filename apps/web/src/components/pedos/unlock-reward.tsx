'use client'

import { ChevronDown, LockOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SongSummary } from '@/lib/catalog/song'
import type { Unlock } from '@/lib/pitch-coverage'
import { Sparks, songList, UnlockedSongRow } from './song-row'

// The Result's reward when a save unlocks Songs (#363, design B, "Locks open"): the Songs show as
// Compose had them a moment ago, locked, and one by one each lock wiggles and opens in pink while
// the count ticks up, then rolls to the total. It makes no sound. Done, Try it, every row and every
// heart answer a tap from the first frame, and with reduced motion it opens on its last frame.

/** How many of `count` unlocked Songs show before See all: up to 4 in full, else the first 3. */
export function shownAtFirst(count: number): number {
  return count <= 4 ? count : 3
}

/** When row `i` (from 0) starts to open: its lock wiggles. In ms from when the Result shows. */
const rowStartMs = (i: number) => 250 + 300 * i
/** When row `i`'s lock opens, and the count ticks up. */
const rowOpensMs = (i: number) => rowStartMs(i) + 170
/** From 5 Songs, the roll to the total starts this long after the 3rd row opens, and lasts… */
const rollDelayMs = 120
const rollMs = 500

/**
 * What the count reads `ms` after the Result shows: 0, then one more as each shown row's lock
 * opens, then from 5 Songs a roll to `count` with an ease-out cubic. `count` from 1.7 s on.
 */
export function countAt(ms: number, count: number): number {
  const shown = shownAtFirst(count)
  let opened = 0
  while (opened < shown && ms >= rowOpensMs(opened)) opened++
  if (opened < shown || shown === count) return opened
  const x = Math.min(1, Math.max(0, (ms - rowOpensMs(shown - 1) - rollDelayMs) / rollMs))
  return Math.round(shown + (count - shown) * (1 - (1 - x) ** 3))
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

/** The count as `countAt` reads it, frame by frame from when it first shows, or at once `count`. */
function useCount(count: number): number {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? count : 0))
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(count)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = countAt(now - start, count)
      setShown(next)
      if (next < count) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [count])
  return shown
}

/**
 * The Songs a save unlocked, in the order given (`orderUnlocked`): a lock badge, the count and
 * "Songs unlocked", then Compose's rows, the first ones opening their locks. From 5 Songs, the
 * first 3 show, then See all, which lists the rest in place, already unlocked, and moves focus to
 * the 4th. A row's tap calls `onOpen`.
 */
export function UnlockReward({
  unlocked,
  onOpen
}: {
  unlocked: readonly Unlock[]
  onOpen: (song: SongSummary) => void
}) {
  const count = unlocked.length
  const opening = shownAtFirst(count)
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? count : opening
  const counted = useCount(count)
  const list = useRef<HTMLUListElement>(null)
  const label = count === 1 ? 'Song unlocked' : 'Songs unlocked'

  useEffect(() => {
    if (!expanded) return
    list.current?.querySelector<HTMLElement>(`:scope > li:nth-child(${opening + 1}) a`)?.focus()
  }, [expanded, opening])

  return (
    <div className="flex flex-col gap-3" data-testid="unlock-reward">
      <div className="flex items-center gap-3 px-1">
        <span
          aria-hidden
          className="relative grid size-10 shrink-0 place-items-center rounded-full bg-brand-strong/15 text-brand-strong motion-safe:animate-unlock-badge dark:bg-brand/20 dark:text-brand"
        >
          <LockOpen className="size-5" />
          <Sparks radius={28} className="motion-safe:animate-unlock-badge-spark" />
        </span>
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="sr-only">{`${count} ${label}`}</span>
          <span
            aria-hidden
            className="text-right text-4xl leading-none font-bold tracking-tight tabular-nums"
            style={{ minWidth: `${String(count).length}ch` }}
            data-testid="unlock-count"
          >
            {counted}
          </span>
          <span
            aria-hidden
            className="text-lg font-semibold whitespace-nowrap motion-safe:animate-unlock-label"
          >
            {label}
          </span>
        </p>
      </div>
      <ul ref={list} className={songList}>
        {unlocked.slice(0, shown).map(({ song, before }, i) => (
          <UnlockedSongRow
            key={song.id}
            song={song}
            onOpen={onOpen}
            unlocking={i < opening ? { before, delayMs: rowStartMs(i) } : undefined}
          />
        ))}
        {shown < count && (
          <li>
            <button
              type="button"
              aria-expanded={false}
              className="flex min-h-12 w-full items-center justify-between gap-3 pr-5 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
              onClick={() => setExpanded(true)}
            >
              {`See all ${count} Songs`}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}
