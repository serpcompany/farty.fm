import type { Song } from '@/lib/catalog/song'
import type { Arrangement } from '@/lib/engine/auto-map'
import { beatRecordings } from '@/lib/engine/beats'
import { renderInWorker } from '@/lib/engine/client'
import type { RecordingToRender, RenderedSong } from '@/lib/engine/render-song'
import type { Song as EngineSong } from '@/lib/engine/song'
import { arrangementOf, engineSong } from '@/lib/pitch-coverage'
import type { Recording } from '@/lib/recordings'
import type { TootArrangement, TootDraft } from '@/lib/toot'
import { decodeWav, encodeWav } from '@/lib/wav'

// Song Creator's render: an Unlocked Song played by the user's Recordings, as a Toot's audio. A
// port of the iPhone app's `TootRenderer` and `makeToot`. The render itself is the engine's
// (`engine/render-song.ts`), in its Web Worker; this module only feeds it what the app stores.

/** Why a Toot wasn't made. As the iPhone app's `TootError`. */
export class TootError extends Error {
  constructor(
    readonly reason: 'locked' | 'couldNotMake',
    options?: ErrorOptions
  ) {
    super(reason === 'locked' ? 'The Song is locked' : "Couldn't make this Toot", options)
    this.name = 'TootError'
  }
}

/** How a Song is rendered: the render worker in the app (`renderInWorker`). */
export type Render = (
  song: EngineSong,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[],
  beats: readonly string[]
) => Promise<RenderedSong>

/** What a Toot keeps of Auto-map's Arrangement, and of the Recordings that play its Beats. */
export function tootArrangement(
  arrangement: Arrangement,
  beats: readonly string[] = []
): TootArrangement {
  const recordingForPitch: Record<number, string> = {}
  for (const choice of arrangement.pitches) {
    if (choice.recordingId !== null) recordingForPitch[choice.songPitch] = choice.recordingId
  }
  const kept = { transposition: arrangement.transposition, recordingForPitch }
  return beats.length === 0 ? kept : { ...kept, beatRecordings: [...beats] }
}

/**
 * The Recordings that play `song`'s Beats, in turn (ADR 0014): the analyzed Noise-like ones
 * among `recordings`, in id order, as many as the Song has bars at most.
 */
export function beatRecordingsOf(song: Song, recordings: readonly Recording[]): string[] {
  const noiseLike = recordings.flatMap(r =>
    r.analysis.state === 'analyzed' && r.analysis.analysis.recordingPitchMidi === null ? [r.id] : []
  )
  return beatRecordings(song, noiseLike)
}

/**
 * Makes the Toot of `song`: the Arrangement Auto-map chooses on `recordings` (the one Compose
 * shows), with a Beat on each bar line from the Noise-like ones (`beatRecordingsOf`), rendered
 * from each Recording it uses as the app stores it, a 16-bit WAV (`loadAudio`), with the
 * Recording's stored analysis. The Toot's audio is the render as a mono 16-bit WAV.
 *
 * Throws a `TootError`: `locked` when the Song isn't unlocked, `couldNotMake` when a Recording's
 * audio or analysis is missing or the render fails. `id` is a new one unless given: the return
 * from Checkout makes the Toot it paid for again (ADR 0010).
 */
export async function makeToot(
  song: Song,
  recordings: readonly Recording[],
  loadAudio: (id: string) => Promise<ArrayBuffer>,
  render: Render = renderInWorker,
  id: string = crypto.randomUUID()
): Promise<TootDraft> {
  const arrangement = arrangementOf(song, recordings)
  if (!arrangement.unlocked) throw new TootError('locked')
  const beats = beatRecordingsOf(song, recordings)
  let rendered: RenderedSong
  try {
    const used = [...new Set([...arrangement.pitches.flatMap(c => c.recordingId ?? []), ...beats])]
    const toRender = await Promise.all(
      used.map(async (id): Promise<RecordingToRender> => {
        const recording = recordings.find(r => r.id === id)
        if (recording?.analysis.state !== 'analyzed') throw new Error(`Recording ${id} is gone`)
        return { id, audio: decodeWav(await loadAudio(id)), analysis: recording.analysis.analysis }
      })
    )
    rendered = await render(engineSong(song), arrangement, toRender, beats)
  } catch (error) {
    throw new TootError('couldNotMake', { cause: error })
  }
  const { samples, sampleRate } = rendered
  return {
    id,
    song,
    arrangement: tootArrangement(arrangement, beats),
    seconds: samples.length / sampleRate,
    wav: encodeWav({ samples, sampleRate })
  }
}
