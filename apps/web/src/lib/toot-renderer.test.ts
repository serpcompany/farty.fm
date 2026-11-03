import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fixtures, fixtureWav } from '../../scripts/fixture-library'
import { goldenArrangement, songIds } from '../test-support/engine-golden'
import { bridgedWorker, WorkerScope } from '../test-support/fake-worker'
import { songs } from '../test-support/songs.generated'
import { analyzeToAnalysis } from './analysis/port'
import { renderInWorker, renderPerformanceInWorker } from './engine/client'
import { type RenderedPerformance, renderPerformance } from './engine/render-performance'
import { type RenderedSong, renderFromRecordings } from './engine/render-song'
import { fixtureRecordingId } from './fixture-library'
import type { Performance } from './performance'
import { arrangementOf, engineSong } from './pitch-coverage'
import type { Recording } from './recordings'
import { makePadToot, makeToot, TootError } from './toot-renderer'
import { decodeWav, encodeWav } from './wav'

const wavs = new Map<string, ArrayBuffer>()
const recordings: Recording[] = []
const loadAudio = async (id: string) => {
  const wav = wavs.get(id)
  if (!wav) throw new Error(`No audio for ${id}`)
  return wav.slice(0)
}

function sameBytes(a: ArrayBufferView | ArrayBuffer | undefined, b: ArrayBufferView | ArrayBuffer) {
  const bytes = (v: ArrayBufferView | ArrayBuffer) =>
    ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.from(v)
  return a !== undefined && a.constructor === b.constructor && bytes(a).equals(bytes(b))
}

const audioGone = async () => {
  throw new Error('No audio')
}

const renderFails = () => Promise.reject(new Error('Rendering failed'))

async function refused(making: Promise<unknown>, reason: TootError['reason']): Promise<TootError> {
  const error = await making.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(TootError)
  expect((error as TootError).reason).toBe(reason)
  return error as TootError
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
    songs
      .filter(s => songIds.includes(s.id) && goldenArrangement('full', s.id).unlocked)
      .map(s => [s.id, s])
  )('renders %s as the engine does on the same WAVs', async (_, song) => {
    let fromWorker: RenderedSong | undefined
    const draft = await makeToot(song, recordings, loadAudio, async (...args) => {
      fromWorker = await renderInWorker(...args)
      return fromWorker
    })

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
    expect(sameBytes(draft.wav, encodeWav(engine)), song.id).toBe(true)
    expect(draft.seconds).toBe(engine.samples.length / 44100)

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
    await refused(makeToot(songs[0], [], loadAudio), 'locked')
    const amazing = songs.filter(s => s.id === 'amazing')[0]
    const without002 = recordings.filter(r => r.id !== fixtureRecordingId('002'))
    await refused(makeToot(amazing, without002, loadAudio), 'locked')
  })

  it("can't be made when a Recording's audio is gone", async () => {
    await refused(makeToot(songs[0], recordings, audioGone), 'couldNotMake')
  })

  it("can't be made when the render fails", async () => {
    const error = await refused(
      makeToot(songs[0], recordings, loadAudio, renderFails),
      'couldNotMake'
    )
    expect((error.cause as Error).message).toBe('Rendering failed')
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
    await refused(makePadToot(played(), recordings.slice(1), loadAudio), 'couldNotMake')
  })

  it("can't be made when a Recording's audio is gone", async () => {
    await refused(makePadToot(played(), recordings, audioGone), 'couldNotMake')
  })

  it("can't be made when the render fails", async () => {
    const error = await refused(
      makePadToot(played(), recordings, loadAudio, renderFails),
      'couldNotMake'
    )
    expect((error.cause as Error).message).toBe('Rendering failed')
  })
})
