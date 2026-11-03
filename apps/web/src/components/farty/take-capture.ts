'use client'

import { useCallback, useRef, useState } from 'react'
import { MicrophoneDeniedError, MicrophoneReleasedError } from '@/lib/audio/microphone'
import { stopPlayback } from '@/lib/audio/player'
import { startTake, type Take } from '@/lib/audio/recorder'
import { atFullLevel, heardSomething, maximumTakeSeconds, TakeLevels } from '@/lib/recordings'
import { reportError } from '@/lib/telemetry/errors'
import type { PcmAudio } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

export type Draft = { audio: PcmAudio; seconds: number; waveform: number[] }

export type Capture =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number; hearsNothing: boolean }
  | { kind: 'finishing'; startedAt: number; stoppedAt: number }

export type RecordProblem = 'microphoneOff' | 'couldNotStart' | 'interrupted' | 'nothingHeard'

export const hintAfterMs = 2000

export type LiveTake = {
  bars(): readonly number[]
  subscribe(listener: () => void): () => void
}

const noBars: readonly number[] = []

function liveTakeStore(): LiveTake & { set(bars: readonly number[]): void } {
  let bars = noBars
  const listeners = new Set<() => void>()
  return {
    bars: () => bars,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      if (next.length === bars.length) return
      bars = next.length === 0 ? noBars : next.slice()
      for (const listener of listeners) listener()
    }
  }
}

type TakeInProgress = { take: Take; startedAt: number; limit: number; hint: number }

function letGo(current: TakeInProgress): void {
  clearTimeout(current.limit)
  clearTimeout(current.hint)
}

function buzz(): void {
  try {
    if ('vibrate' in window.navigator) window.navigator.vibrate(40)
  } catch {
    return
  }
}

function draftOf({ samples, sampleRate }: PcmAudio): Draft {
  const level = atFullLevel(samples)
  return {
    audio: { samples: level, sampleRate },
    seconds: level.length / sampleRate,
    waveform: waveformLevels(level, 40)
  }
}

function judgeLevels(
  take: Take,
  isCurrent: () => boolean,
  live: ReturnType<typeof liveTakeStore>,
  hearsNothing: (nothing: boolean) => void
): () => void {
  const levels = new TakeLevels(take.sampleRate)
  let judging = false
  const judge = () => {
    if (isCurrent()) hearsNothing(!levels.heard())
  }
  take.listen(batch => {
    if (!isCurrent()) return
    levels.add(batch)
    live.set(levels.bars)
    if (judging) judge()
  })
  return () => {
    judging = true
    judge()
  }
}

export function useTakeCapture(flowOpen: boolean, review: (draft: Draft) => void) {
  const [capture, setCapture] = useState<Capture>({ kind: 'idle' })
  const [problem, setProblem] = useState<RecordProblem | null>(null)
  const [liveTake] = useState(liveTakeStore)
  const take = useRef<TakeInProgress | null>(null)

  const stopRecording = useCallback(async () => {
    const current = take.current
    if (!current) return
    take.current = null
    letGo(current)
    setCapture({ kind: 'finishing', startedAt: current.startedAt, stoppedAt: Date.now() })
    const audio = await current.take.stop()
    liveTake.set(noBars)
    setCapture({ kind: 'idle' })
    if (audio.samples.length === 0 || !heardSomething(audio.samples, audio.sampleRate)) {
      setProblem('nothingHeard')
      return
    }
    review(draftOf(audio))
  }, [liveTake, review])

  const loseTake = useCallback(() => {
    if (!take.current) return
    letGo(take.current)
    take.current = null
    liveTake.set(noBars)
    setCapture({ kind: 'idle' })
    setProblem('interrupted')
  }, [liveTake])

  const showHearsNothing = useCallback((hearsNothing: boolean) => {
    setCapture(shown =>
      shown.kind === 'recording' && shown.hearsNothing !== hearsNothing
        ? { ...shown, hearsNothing }
        : shown
    )
  }, [])

  const startRecording = useCallback(async () => {
    if (capture.kind !== 'idle' || flowOpen) return
    stopPlayback()
    setProblem(null)
    liveTake.set(noBars)
    setCapture({ kind: 'starting' })
    try {
      const started = await startTake(loseTake, error => reportError('mic-start-retried', error))
      const current: TakeInProgress = {
        take: started,
        startedAt: Date.now(),
        limit: window.setTimeout(() => void stopRecording(), maximumTakeSeconds * 1000),
        hint: 0
      }
      take.current = current
      const startJudging = judgeLevels(
        started,
        () => take.current === current,
        liveTake,
        showHearsNothing
      )
      current.hint = window.setTimeout(startJudging, hintAfterMs)
      setCapture({ kind: 'recording', startedAt: current.startedAt, hearsNothing: false })
      buzz()
    } catch (error) {
      const lost = take.current
      if (lost) {
        take.current = null
        letGo(lost)
        lost.take.cancel()
      }
      liveTake.set(noBars)
      setCapture({ kind: 'idle' })
      if (error instanceof MicrophoneReleasedError) return
      const denied = error instanceof MicrophoneDeniedError
      reportError(denied ? 'mic-denied' : 'mic-start-failed', error)
      setProblem(denied ? 'microphoneOff' : 'couldNotStart')
    }
  }, [capture.kind, flowOpen, liveTake, loseTake, stopRecording, showHearsNothing])

  const dismissProblem = useCallback(() => setProblem(null), [])

  return { capture, problem, liveTake, startRecording, stopRecording, dismissProblem }
}
