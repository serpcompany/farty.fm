import 'server-only'

import { cache } from 'react'
import { getDb } from '@/db'
import { showsFartPlaces } from '@/db/sharing'
import { NOT_SAID, type RecordedIn, recordedInOf } from '@/lib/fart-place'
import { noteName } from '@/lib/pitch'
import { recordingName, songPitch, type Trim } from '@/lib/recordings'
import { findSharedRecording, partBars, recordingFart, sharedPart } from '@/server/sharing'

/** What a shared Recording's page, and its link image, show of it: nothing private. */
export type SharedView = {
  handle: string
  /** What its link ends in. */
  slug: string
  /** "Recording 8". */
  name: string
  /** The note Songs use it for, "E3", or null for a Noise-like one. */
  note: string | null
  /** "1.1 s": its fart's length, as its profile page row prints and plays it (`recordingFart`). */
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
} & RecordedIn

/**
 * The shared Recording at `/@<handle>/r/<id>/`, by its slug or its old random id, or null when that
 * link doesn't work: never shared, stopped, taken down, or its Recording or account deleted. Once
 * per request.
 */
export const sharedView = cache(async (handle: string, id: string): Promise<SharedView | null> => {
  const db = getDb()
  const shared = await findSharedRecording(db, handle, id)
  if (!shared) return null
  const { recording } = shared
  const { place } = shared.row.recording
  const pitch = songPitch(recording)
  const part = sharedPart(recording)
  return {
    handle: shared.handle,
    slug: shared.slug,
    name: recordingName(recording),
    note: pitch === null ? null : noteName(pitch),
    length: recordingFart(recording).length,
    part: { startSeconds: 0, endSeconds: part.endSeconds - part.startSeconds },
    levels: partBars(recording.waveform, recording.seconds, part),
    recordedAt: recording.createdAt,
    ...(place && (await showsFartPlaces(db, shared.row.share.userId))
      ? recordedInOf(place)
      : NOT_SAID)
  }
})

/** "A fart", "An E3 fart": what the link's description and image call it. */
export function fartPhrase(note: string | null): string {
  if (note === null) return 'A fart'
  // "An A3", "an E3", "an F3": each reads with a vowel sound.
  return `${/^[AEF]/.test(note) ? 'An' : 'A'} ${note} fart`
}
