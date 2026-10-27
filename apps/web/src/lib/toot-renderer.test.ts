import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fixtures, fixtureWav } from '../../scripts/fixture-library'
import { goldenArrangement } from '../test-support/engine-golden'
import { bridgedWorker, WorkerScope } from '../test-support/fake-worker'
import { analyzeToAnalysis } from './analysis/port'
import { songs } from './catalog/songs.generated'
import { renderInWorker } from './engine/client'
import { type RenderedSong, renderFromRecordings } from './engine/render-song'
import { fixtureRecordingId } from './fixture-library'
import { arrangementOf, engineSong } from './pitch-coverage'
import type { Recording } from './recordings'
import { makeToot, TootError } from './toot-renderer'
import { decodeWav, encodeWav } from './wav'

// Song Creator's render on the Fixture Library as the app stores it: each fixture as a 16-bit
// WAV, analyzed as a new Recording is. Through the render worker, a Toot is the engine's render
// (#108) bit for bit, on the golden Arrangement.

const wavs = new Map<string, ArrayBuffer>()
const recordings: Recording[] = []
/** The stored WAV, as a fresh copy each time, as IndexedDB gives it. */
const loadAudio = async (id: string) => {
  const wav = wavs.get(id)
  if (!wav) throw new Error(`No audio for ${id}`)
  return wav.slice(0)
}

beforeAll(async () => {
  for (const [i, { id, filename }] of fixtures().entries()) {
    const wav = await fixtureWav(filename)
    const { samples, sampleRate } = decodeWav(wav)
    const recordingId = fixtureRecordingId(id)
    wavs.set(recordingId, wav)
    recordings.push({
      id: recordingId,
      number: i + 1,
      createdAt: 0,
      seconds: samples.length / sampleRate,
      sampleRate,
      waveform: [],
      analysis: { state: 'analyzed', analysis: analyzeToAnalysis(samples, sampleRate) }
    })
  }
  // The render worker, on this thread: `renderInWorker` posts to the real `engine/worker.ts`.
  const scope = new WorkerScope()
  vi.stubGlobal('self', scope)
  vi.stubGlobal('Worker', bridgedWorker(scope))
  await import('./engine/worker')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('makeToot', () => {
  it.each(
    songs.filter(s => goldenArrangement('full', s.id).unlocked).map(s => [s.id, s])
  )('renders %s as the engine does on the same WAVs', async (_, song) => {
    let fromWorker: RenderedSong | undefined
    const draft = await makeToot(song, recordings, loadAudio, async (...args) => {
      fromWorker = await renderInWorker(...args)
      return fromWorker
    })

    // The engine itself, on the same 16-bit WAVs and stored analyses.
    const arrangement = arrangementOf(song, recordings)
    const used = new Set(arrangement.pitches.map(c => c.recordingId))
    const inputs = recordings
      .filter(r => used.has(r.id))
      .map(r => ({
        id: r.id,
        audio: decodeWav(wavs.get(r.id) as ArrayBuffer),
        analysis: r.analysis.state === 'analyzed' ? r.analysis.analysis : (null as never)
      }))
    const engine = renderFromRecordings(engineSong(song), arrangement, inputs)
    expect(fromWorker?.samples).toEqual(engine.samples)
    // The Toot's audio is that render as a 16-bit WAV, byte for byte.
    expect(new Uint8Array(draft.wav)).toEqual(new Uint8Array(encodeWav(engine)))
    expect(draft.seconds).toBe(engine.samples.length / 44100)

    // On the golden Arrangement.
    const golden = goldenArrangement('full', song.id)
    expect(draft.arrangement.transposition).toBe(golden.transpose)
    for (const entry of golden.per_pitch) {
      expect(draft.arrangement.recordingForPitch[entry.song_pitch]).toBe(
        fixtureRecordingId(entry.recording as string)
      )
    }
    expect(draft.song).toBe(song)
  })

  it('is locked without the Recordings to unlock the Song', async () => {
    const error = await makeToot(songs[0], [], loadAudio).catch(e => e)
    expect(error).toBeInstanceOf(TootError)
    expect(error.reason).toBe('locked')
    // Amazing Grace stays locked with the whole Fixture Library: its 2.98 s note outlasts every
    // fixture (ADR 0011).
    const amazing = songs.filter(s => s.id === 'amazing')[0]
    const tooLong = await makeToot(amazing, recordings, loadAudio).catch(e => e)
    expect(tooLong).toBeInstanceOf(TootError)
    expect(tooLong.reason).toBe('locked')
  })

  it("can't be made when a Recording's audio is gone", async () => {
    const error = await makeToot(songs[0], recordings, async () => {
      throw new Error('No audio')
    }).catch(e => e)
    expect(error).toBeInstanceOf(TootError)
    expect(error.reason).toBe('couldNotMake')
  })

  it("can't be made when the render fails", async () => {
    const error = await makeToot(songs[0], recordings, loadAudio, () =>
      Promise.reject(new Error('Rendering failed'))
    ).catch(e => e)
    expect(error).toBeInstanceOf(TootError)
    expect(error.reason).toBe('couldNotMake')
    expect(error.cause.message).toBe('Rendering failed')
  })
})
