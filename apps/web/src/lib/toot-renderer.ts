import type { Song } from '@/lib/catalog/song'
import type { Arrangement } from '@/lib/engine/auto-map'
import { renderInWorker, renderPerformanceInWorker } from '@/lib/engine/client'
import type { PerformanceRecording, RenderedPerformance } from '@/lib/engine/render-performance'
import type { RecordingToRender, RenderedSong } from '@/lib/engine/render-song'
import type { Song as EngineSong } from '@/lib/engine/song'
import type { Performance } from '@/lib/performance'
import { arrangementOf, engineSong } from '@/lib/pitch-coverage'
import type { Recording } from '@/lib/recordings'
import type { PadTootDraft, SongTootDraft, TootArrangement } from '@/lib/toot'
import { decodeWav, encodeWav } from '@/lib/wav'

// Song Creator's render: an Unlocked Song played by the user's Recordings, as a Toot's audio. A
// port of the iPhone app's `TootRenderer` and `makeToot`. And the Sound Pad's: a Performance
// played by them (`makePadToot`, #278). The render itself is the engine's
// (`engine/render-song.ts`, `engine/render-performance.ts`), in its Web Worker; this module only
// feeds it what the app stores.

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
  recordings: readonly RecordingToRender[]
) => Promise<RenderedSong>

/** What a Toot keeps of Auto-map's Arrangement. */
export function tootArrangement(arrangement: Arrangement): TootArrangement {
  const recordingForPitch: Record<number, string> = {}
  for (const choice of arrangement.pitches) {
    if (choice.recordingId !== null) recordingForPitch[choice.songPitch] = choice.recordingId
  }
  return { transposition: arrangement.transposition, recordingForPitch }
}

/**
 * Makes the Toot of `song`: the Arrangement Auto-map chooses on `recordings` (the one Compose
 * shows), rendered from each Recording it uses as the app stores it, a 16-bit WAV
 * (`loadAudio`), with the Recording's stored analysis. The Toot's audio is the render as a mono
 * 16-bit WAV.
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
): Promise<SongTootDraft> {
  const arrangement = arrangementOf(song, recordings)
  if (!arrangement.unlocked) throw new TootError('locked')
  let rendered: RenderedSong
  try {
    const used = [...new Set(arrangement.pitches.flatMap(c => c.recordingId ?? []))]
    const toRender = await Promise.all(
      used.map(async (id): Promise<RecordingToRender> => {
        const recording = recordings.find(r => r.id === id)
        if (recording?.analysis.state !== 'analyzed') throw new Error(`Recording ${id} is gone`)
        return { id, audio: decodeWav(await loadAudio(id)), analysis: recording.analysis.analysis }
      })
    )
    rendered = await render(engineSong(song), arrangement, toRender)
  } catch (error) {
    throw new TootError('couldNotMake', { cause: error })
  }
  const { samples, sampleRate } = rendered
  return {
    id,
    song,
    arrangement: tootArrangement(arrangement),
    seconds: samples.length / sampleRate,
    wav: encodeWav({ samples, sampleRate })
  }
}

/** How a Performance is rendered: the render worker in the app (`renderPerformanceInWorker`). */
export type RenderPerformance = (
  performance: Performance,
  recordings: readonly PerformanceRecording[]
) => Promise<RenderedPerformance>

/**
 * Makes the Toot of a Sound Pad `performance` (ADR 0016): each Recording it plays, as the app
 * stores it (`loadAudio`), rendered in the render worker (`renderPerformance`). The Toot's audio
 * is the render as a mono 16-bit WAV. Throws a `couldNotMake` `TootError` when a Recording it
 * plays is gone or its audio can't be read, or the render fails. `id` is a new one unless given:
 * back from Checkout, the take it paid for is made again (ADR 0010).
 */
export async function makePadToot(
  performance: Performance,
  recordings: readonly Recording[],
  loadAudio: (id: string) => Promise<ArrayBuffer>,
  render: RenderPerformance = renderPerformanceInWorker,
  id: string = crypto.randomUUID()
): Promise<PadTootDraft> {
  let rendered: RenderedPerformance
  try {
    const toRender = await Promise.all(
      performance.recordings.map(async (recordingId): Promise<PerformanceRecording> => {
        if (!recordings.some(r => r.id === recordingId)) {
          throw new Error(`Recording ${recordingId} is gone`)
        }
        return { id: recordingId, audio: decodeWav(await loadAudio(recordingId)) }
      })
    )
    rendered = await render(performance, toRender)
  } catch (error) {
    throw new TootError('couldNotMake', { cause: error })
  }
  const { samples, sampleRate } = rendered
  return {
    id,
    song: null,
    performance,
    seconds: samples.length / sampleRate,
    wav: encodeWav({ samples, sampleRate })
  }
}
