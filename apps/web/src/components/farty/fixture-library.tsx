'use client'

import { useEffect, useId, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { type FixtureIndex, fixtureLibraryPath, fixtureRecordingId } from '@/lib/fixture-library'
import { useRecordings } from './recordings-provider'

export function FixtureLibrary() {
  const { recordings, importRecordings } = useRecordings()
  const [index, setIndex] = useState<FixtureIndex | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [didFail, setDidFail] = useState(false)
  const headerId = useId()

  useEffect(() => {
    let current = true
    fetch(`${fixtureLibraryPath}index.json`)
      .then(response => (response.ok ? (response.json() as Promise<FixtureIndex>) : null))
      .then(found => current && setIndex(found))
      .catch(() => current && setIndex(null))
    return () => {
      current = false
    }
  }, [])

  if (index === null || recordings === null) return null

  const saved = new Set(recordings.map(r => r.id))
  const missing = index.recordings.filter(f => !saved.has(fixtureRecordingId(f.id)))
  const total = index.recordings.length
  const loaded = total - missing.length
  const isComplete = loaded >= total

  const load = async () => {
    setIsLoading(true)
    setDidFail(false)
    try {
      const files = await Promise.all(
        missing.map(async fixture => {
          const response = await fetch(`${fixtureLibraryPath}${fixture.file}`)
          if (!response.ok) throw new Error(`No fixture ${fixture.id}`)
          return { id: fixtureRecordingId(fixture.id), wav: await response.arrayBuffer() }
        })
      )
      await importRecordings(files)
    } catch {
      setDidFail(true)
    } finally {
      setIsLoading(false)
    }
  }

  const label = isLoading
    ? 'Loading the Fixture Library…'
    : isComplete
      ? 'Fixture Library loaded'
      : 'Load the Fixture Library'

  return (
    <section aria-labelledby={headerId} className="pt-6" data-testid="fixture-library">
      <h2 id={headerId} className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
        Internal build
      </h2>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 text-left text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:text-muted-foreground"
        disabled={isLoading || isComplete}
        onClick={() => void load()}
        data-testid="load-fixture-library"
      >
        <span className="flex-1">{label}</span>
        {isLoading && <Spinner />}
        <span className="text-muted-foreground tabular-nums" data-testid="fixture-library-count">
          {loaded} of {total}
        </span>
      </button>
      {didFail && (
        <p role="alert" className="px-4 pt-1.5 text-sm text-destructive">
          The Fixture Library didn’t load. Try again.
        </p>
      )}
      <p className="px-4 pt-1.5 text-xs text-muted-foreground">
        Adds the {total} test farts as your own Recordings, analyzed like real ones. Loading again
        adds only the missing ones.
      </p>
    </section>
  )
}
