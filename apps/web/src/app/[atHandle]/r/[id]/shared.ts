import 'server-only'

import { cache } from 'react'
import { getDb } from '@/db'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { recordingName, songPitch, type Trim } from '@/lib/recordings'
import { findSharedRecording, partBars, sharedPart } from '@/server/sharing'

/** What a shared Recording's page, and its link image, show of it: nothing private. */
export type SharedView = {
  handle: string
  /** What its link ends in. */
  slug: string
  /** "Recording 8". */
  name: string
  /** The note Songs use it for, "E3", or null for a Noise-like one. */
  note: string | null
  /** "1.1 s": its fart's length, as its row shows it. */
  length: string
  /**
   * The audio its link serves, from 0: its stored Trim, or else the whole take, cut on its own
   * (`sharedPart`, `sharedAudio`), so none of the take outside it is public.
   */
  part: Trim
  /** The loudness bars of `part`, from the upload, each 0…1. */
  levels: number[]
  /** When it was recorded, in ms. */
  recordedAt: number
}

/**
 * The shared Recording at `/@<handle>/r/<id>/`, by its slug or its old random id, or null when that
 * link doesn't work: never shared, stopped, taken down, or its Recording or account deleted. Once
 * per request.
 */
export const sharedView = cache(async (handle: string, id: string): Promise<SharedView | null> => {
  const shared = await findSharedRecording(getDb(), handle, id)
  if (!shared) return null
  const { recording } = shared
  const pitch = songPitch(recording)
  const part = sharedPart(recording)
  return {
    handle: shared.handle,
    slug: shared.slug,
    name: recordingName(recording),
    note: pitch === null ? null : noteName(pitch),
    length: formattedFartLength(recording),
    part: { startSeconds: 0, endSeconds: part.endSeconds - part.startSeconds },
    levels: partBars(recording.waveform, recording.seconds, part),
    recordedAt: recording.createdAt
  }
})

/** "A fart", "An E3 fart": what the link's description and image call it. */
export function fartPhrase(note: string | null): string {
  if (note === null) return 'A fart'
  // "An A3", "an E3", "an F3": each reads with a vowel sound.
  return `${/^[AEF]/.test(note) ? 'An' : 'A'} ${note} fart`
}
