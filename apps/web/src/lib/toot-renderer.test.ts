import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fixtures, fixtureWav } from '../../scripts/fixture-library'
import { goldenArrangement, songIds } from '../test-support/engine-golden'
import { bridgedWorker, WorkerScope } from '../test-support/fake-worker'
import { analyzeToAnalysis } from './analysis/port'
import { songs } from './catalog/songs.generated'
import { songPitches } from './engine/auto-map'
import { renderInWorker, renderPerformanceInWorker } from './engine/client'
import { noChoices, swapFart } from './engine/fart-choices'
import { type RenderedPerformance, renderPerformance } from './engine/render-performance'
import { type RenderedSong, renderFromRecordings } from './engine/render-song'
import { fartSheet } from './fart-sheet'
import { fixtureRecordingId } from './fixture-library'
import type { Performance } from './performance'
import { arrangementOf, autoMapRecordings, engineSong } from './pitch-coverage'
import type { Recording } from './recordings'
import { makePadToot, makeToot, TootError } from './toot-renderer'
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

/**
 * Whether two renders hold the same bytes, bit for bit. One comparison of the whole buffer:
 * `toEqual` walks every sample, minutes across the catalog's Songs.
 */
function sameBytes(a: ArrayBufferView | ArrayBuffer | undefined, b: ArrayBufferView | ArrayBuffer) {
  const bytes = (v: ArrayBufferView | ArrayBuffer) =>
    ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.from(v)
  return a !== undefined && a.constructor === b.constructor && bytes(a).equals(bytes(b))
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
  // Each Song the reference engine's golden data arranges and unlocks (#350).
  it.each(
    songs
      .filter(s => songIds.includes(s.id) && goldenArrangement('full', s.id).unlocked)
      .map(s => [s.id, s])
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
    expect(fromWorker?.samples.length).toBe(engine.samples.length)
    expect(sameBytes(fromWorker?.samples, engine.samples), song.id).toBe(true)
    // The Toot's audio is that render as a 16-bit WAV, byte for byte.
    expect(sameBytes(draft.wav, encodeWav(engine)), song.id).toBe(true)
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
    // Amazing Grace is locked without 002: its 2.98 s note outlasts every other fixture (ADR
    // 0011). 002 lasts 4.04 s, every burst (ADR 0016).
    const amazing = songs.filter(s => s.id === 'amazing')[0]
    const without002 = recordings.filter(r => r.id !== fixtureRecordingId('002'))
    const tooLong = await makeToot(amazing, without002, loadAudio).catch(e => e)
    expect(tooLong).toBeInstanceOf(TootError)
    expect(tooLong.reason).toBe('locked')
  })

  it('plays the farts the user chose, and is locked once a note has none (#360)', async () => {
    const song = songs.find(s => s.id === 'twinkle') as (typeof songs)[number]
    const pitches = songPitches(engineSong(song))
    const pitch = pitches.pitches[0]
    const sheet = fartSheet(pitches, autoMapRecordings(recordings), null, pitch)
    const swapIn = (sheet.free[0] ?? sheet.others[0]).id
    const choices = swapFart(
      noChoices(arrangementOf(song, recordings).transposition),
      pitch,
      swapIn
    )
    let fromWorker: RenderedSong | undefined
    const draft = await makeToot(
      song,
      recordings,
      loadAudio,
      async (...args) => {
        fromWorker = await renderInWorker(...args)
        return fromWorker
      },
      'swapped',
      choices
    )
    expect(draft.arrangement.recordingForPitch[pitch]).toBe(swapIn)
    const arrangement = arrangementOf(song, recordings, choices)
    const inputs = recordings
      .filter(r => arrangement.pitches.some(c => c.recordingId === r.id))
      .map(r => ({
        id: r.id,
        audio: decodeWav(wavs.get(r.id) as ArrayBuffer),
        analysis: r.analysis.state === 'analyzed' ? r.analysis.analysis : (null as never)
      }))
    const engine = renderFromRecordings(engineSong(song), arrangement, inputs)
    expect(sameBytes(fromWorker?.samples, engine.samples)).toBe(true)

    const everyFart = [sheet.inUse, ...sheet.free, ...sheet.others].flatMap(r => (r ? [r.id] : []))
    const locked = await makeToot(song, recordings, loadAudio, undefined, 'locked', {
      transposition: arrangement.transposition,
      preferred: {},
      excluded: everyFart.sort()
    }).catch(e => e)
    expect(locked).toBeInstanceOf(TootError)
    expect(locked.reason).toBe('locked')
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

describe('makePadToot', () => {
  const played = (): Performance => ({
    recordings: [recordings[0].id, recordings[1].id],
    taps: [
      [0, 0],
      [0.25, 1],
      [0.6, 0]
    ]
  })

  it('renders the Performance as the engine does on the same WAVs (ADR 0017)', async () => {
    const performance = played()
    let fromWorker: RenderedPerformance | undefined
    const draft = await makePadToot(
      performance,
      recordings,
      loadAudio,
      async (...args) => {
        fromWorker = await renderPerformanceInWorker(...args)
        return fromWorker
      },
      'the-paid-id'
    )
    const engine = renderPerformance(
      performance,
      performance.recordings.map(id => ({
        id,
        audio: decodeWav(wavs.get(id) as ArrayBuffer)
      }))
    )
    expect(fromWorker?.samples).toEqual(engine.samples)
    expect(new Uint8Array(draft.wav)).toEqual(new Uint8Array(encodeWav(engine)))
    expect(draft).toMatchObject({
      id: 'the-paid-id',
      song: null,
      performance,
      seconds: engine.samples.length / 44100
    })
  })

  it("can't be made when a Recording it plays is gone", async () => {
    const error = await makePadToot(played(), recordings.slice(1), loadAudio).catch(e => e)
    expect(error).toBeInstanceOf(TootError)
    expect(error.reason).toBe('couldNotMake')
  })

  it("can't be made when a Recording's audio is gone", async () => {
    const error = await makePadToot(played(), recordings, async () => {
      throw new Error('No audio')
    }).catch(e => e)
    expect(error).toBeInstanceOf(TootError)
    expect(error.reason).toBe('couldNotMake')
  })

  it("can't be made when the render fails", async () => {
    const error = await makePadToot(played(), recordings, loadAudio, () =>
      Promise.reject(new Error('Rendering failed'))
    ).catch(e => e)
    expect(error).toBeInstanceOf(TootError)
    expect(error.reason).toBe('couldNotMake')
    expect(error.cause.message).toBe('Rendering failed')
  })
})
