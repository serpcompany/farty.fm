import 'server-only'

import { cache } from 'react'
import { getDb } from '@/db'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { recordingName, songPitch, type Trim } from '@/lib/recordings'
import { findSharedRecording, sharedPart } from '@/server/sharing'

type SharedView = {
  handle: string
  shareId: string
  name: string
  note: string | null
  length: string
  part: Trim
  levels: number[]
}

export const sharedView = cache(async (handle: string, id: string): Promise<SharedView | null> => {
  const shared = await findSharedRecording(getDb(), handle, id)
  if (!shared) return null
  const { recording } = shared
  const pitch = songPitch(recording)
  const part = sharedPart(recording)
  return {
    handle: shared.handle,
    shareId: shared.shareId,
    name: recordingName(recording),
    note: pitch === null ? null : noteName(pitch),
    length: formattedFartLength(recording),
    part: { startSeconds: 0, endSeconds: part.endSeconds - part.startSeconds },
    levels: partBars(recording.waveform, recording.seconds, part)
  }
})

function partBars(waveform: number[], seconds: number, part: Trim): number[] {
  if (waveform.length === 0 || seconds <= 0) return waveform
  const from = Math.floor((part.startSeconds / seconds) * waveform.length)
  const to = Math.ceil((part.endSeconds / seconds) * waveform.length)
  const bars = waveform.slice(Math.max(0, from), Math.max(from + 1, to))
  return bars.length > 0 ? bars : waveform
}

export function fartPhrase(note: string | null): string {
  if (note === null) return 'A fart'
  return `${/^[AEF]/.test(note) ? 'An' : 'A'} ${note} fart`
}
