'use client'

import { type ReactNode, useEffect, useState } from 'react'

export function useNote(): [ReactNode, (note: string | null) => void] {
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (note === null) return
    const timer = setTimeout(() => setNote(null), 3_000)
    return () => clearTimeout(timer)
  }, [note])
  const shown = note && (
    <output
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg md:top-20 md:bottom-auto"
    >
      {note}
    </output>
  )
  return [shown, setNote]
}
