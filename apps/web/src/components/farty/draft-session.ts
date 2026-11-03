'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { analyze } from '@/lib/analysis/client'
import { forgetDecoded } from '@/lib/audio/player'
import type { AnalysisState, Trim } from '@/lib/recordings'
import { reportError } from '@/lib/telemetry/errors'
import { decodeWav, encodeWav } from '@/lib/wav'
import { type Sound, takeSound } from './playback-provider'
import type { Draft } from './take-capture'

type DraftSession = {
  draft: Draft
  wav: ArrayBuffer
  key: string
  analysis: Promise<AnalysisState>
}

const analyzing: AnalysisState = { state: 'analyzing' }

function analysisOf(wav: ArrayBuffer): Promise<AnalysisState> {
  return analyze(decodeWav(wav)).then(
    (found): AnalysisState => ({ state: 'analyzed', analysis: found }),
    (error): AnalysisState => {
      reportError('analysis-failed', error)
      return { state: 'notAnalyzed' }
    }
  )
}

export function useDraftSession(reviewing: Draft | null) {
  const session = useRef<DraftSession | null>(null)
  const [analyzed, setAnalyzed] = useState<{ draft: Draft; state: AnalysisState } | null>(null)

  const sessionOf = useCallback((draft: Draft): DraftSession => {
    const current = session.current
    if (current?.draft === draft) return current
    if (current) forgetDecoded(current.key)
    const wav = encodeWav(draft.audio)
    const started = { draft, wav, key: `draft-${crypto.randomUUID()}`, analysis: analysisOf(wav) }
    session.current = started
    void started.analysis.then(state => {
      if (session.current === started) setAnalyzed({ draft, state })
    })
    return started
  }, [])

  useEffect(() => {
    if (reviewing) sessionOf(reviewing)
  }, [reviewing, sessionOf])

  const letGoOfDraft = useCallback(() => {
    if (session.current) forgetDecoded(session.current.key)
    session.current = null
    setAnalyzed(null)
  }, [])

  const draftSound = useCallback((part: Trim | null): Sound | null => {
    const current = session.current
    if (!current) return null
    const { key, wav, draft } = current
    return takeSound(
      { key: 'draft', decodeKey: key, wav: async () => wav.slice(0), seconds: draft.seconds },
      part
    )
  }, [])

  const draftAnalysis =
    reviewing === null ? null : analyzed?.draft === reviewing ? analyzed.state : analyzing

  return { sessionOf, draftAnalysis, letGoOfDraft, draftSound }
}
