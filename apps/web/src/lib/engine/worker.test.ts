import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bridgedWorker, manualWorker, WorkerScope } from '../../test-support/fake-worker'
import { decoded, goldenRecordings } from '../../test-support/golden'
import type { Analysis } from '../recordings'
import { type Arrangement, arrange, autoMapRecording } from './auto-map'
import type { RecordingToRender, RenderedSong } from './render-song'
import { renderFromRecordings } from './render-song'
import type { Song } from './song'
import type { RenderRequest } from './worker'

// The render worker (`worker.ts`) and the page's side of it (`client.ts`): requests answered by
// id, the audio moved to the page rather than copied, and every way a render can fail.

/** One Melodic fixture with its golden analysis, and a one-note Song on its nearest note. */
let recording: RecordingToRender
let song: Song
let unlocked: Arrangement
let locked: Arrangement

beforeAll(async () => {
  const golden = goldenRecordings.find(r => r.id === '090')
  if (!golden?.melodic || golden.recording_pitch_midi === null) throw new Error('090 is Melodic')
  const file = await decoded(golden)
  const analysis: Analysis = {
    gestureStartSeconds: golden.gesture.start_s,
    gestureEndSeconds: golden.gesture.end_s,
    cutAtReattack: golden.gesture.cut_at_reattack,
    pitchEstimateMidi: golden.pitch_estimate_midi,
    pitchConfidence: golden.pitch_confidence,
    recordingPitchMidi: golden.recording_pitch_midi,
    shortestNoteSeconds: golden.shortest_note_s
  }
  recording = { id: '090', audio: { samples: file.samples, sampleRate: file.sampleRate }, analysis }
  const pitch = Math.round(golden.recording_pitch_midi)
  song = { bpm: 120, bar_lines: [0], length_beats: 2, notes: [{ start: 0, dur: 1, pitch }] }
  unlocked = arrange(song, [autoMapRecording('090', analysis)])
  locked = arrange(song, [])
  expect(unlocked.unlocked).toBe(true)
  expect(locked.unlocked).toBe(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** The worker module, freshly loaded on its own `self`. */
async function startWorker(): Promise<WorkerScope> {
  const scope = new WorkerScope()
  vi.stubGlobal('self', scope)
  await import('./worker')
  return scope
}

/** Posts `request` to the worker and waits for its reply. */
async function ask(scope: WorkerScope, request: RenderRequest) {
  const count = scope.posted.length
  scope.onmessage?.(new MessageEvent('message', { data: request }))
  await vi.waitFor(() => expect(scope.posted.length).toBe(count + 1))
  return scope.posted[count] as {
    message: { id: number; rendered?: RenderedSong; error?: string }
    transfer: Transferable[]
  }
}

describe('the render worker', () => {
  it('answers by id with the render, and transfers its audio instead of copying it', async () => {
    const scope = await startWorker()
    let onPage: RenderedSong | undefined
    scope.page = { onmessage: event => (onPage = event.data.rendered) }
    const { message, transfer } = await ask(scope, {
      id: 7,
      song,
      arrangement: unlocked,
      recordings: [recording]
    })
    expect(message.id).toBe(7)
    expect(message.error).toBeUndefined()
    const rendered = message.rendered as RenderedSong
    expect(transfer).toEqual([rendered.samples.buffer])
    // Posting moved the buffer to the page: the worker's side is left detached, and empty.
    expect(rendered.samples.buffer.byteLength).toBe(0)
    await vi.waitFor(() => expect(onPage).toBeDefined())
    const direct = renderFromRecordings(song, unlocked, [recording])
    expect(direct.samples.length).toBeGreaterThan(0)
    expect(onPage?.samples).toEqual(direct.samples)
    expect(onPage?.sampleRate).toBe(44100)
    expect(onPage?.notes).toEqual(direct.notes)
  })

  it('answers with the error, and transfers nothing, when the render throws', async () => {
    const scope = await startWorker()
    const { message, transfer } = await ask(scope, {
      id: 3,
      song,
      arrangement: locked,
      recordings: [recording]
    })
    expect(message).toEqual({ id: 3, error: 'Song is locked: 0 of 1 notes covered' })
    expect(transfer).toEqual([])
  })
})

describe('renderInWorker', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders in one module worker, answering each request with its own reply', async () => {
    const scope = await startWorker()
    const Worker = bridgedWorker(scope)
    vi.stubGlobal('Worker', Worker)
    const { renderInWorker } = await import('./client')
    const later = { ...song, notes: [{ ...song.notes[0], start: 1 }] }
    const laterArrangement = arrange(later, [autoMapRecording('090', recording.analysis)])
    const [first, second] = await Promise.all([
      renderInWorker(song, unlocked, [recording]),
      renderInWorker(later, laterArrangement, [recording])
    ])
    expect(Worker.created).toHaveLength(1)
    expect(Worker.created[0].url.pathname).toMatch(/\/engine\/worker\.ts$/)
    expect(Worker.created[0].options).toEqual({ type: 'module' })
    // Bit for bit the engine's render, each for its own request.
    expect(first.samples).toEqual(renderFromRecordings(song, unlocked, [recording]).samples)
    expect(second.samples).toEqual(
      renderFromRecordings(later, laterArrangement, [recording]).samples
    )
    expect(second.notes[0].startSample).toBe(first.notes[0].startSample + 22050)
    // The Recording's audio was copied to the worker: the page keeps its own.
    expect(recording.audio.samples.buffer.byteLength).toBeGreaterThan(0)
  })

  it("rejects with the worker's error", async () => {
    const scope = await startWorker()
    vi.stubGlobal('Worker', bridgedWorker(scope))
    const { renderInWorker } = await import('./client')
    await expect(renderInWorker(song, locked, [recording])).rejects.toThrow(
      'Song is locked: 0 of 1 notes covered'
    )
  })

  it('rejects a reply with neither a render nor an error, and ignores unknown ids', async () => {
    const Worker = manualWorker()
    vi.stubGlobal('Worker', Worker)
    const { renderInWorker } = await import('./client')
    const rendering = renderInWorker(song, unlocked, [recording])
    const worker = Worker.created[0]
    const { id } = worker.received[0] as RenderRequest
    worker.reply({ id: id + 1, error: 'not this one' })
    worker.reply({ id })
    await expect(rendering).rejects.toThrow('Rendering failed')
  })

  it('rejects every pending request when the worker fails, then starts a new worker', async () => {
    const Worker = manualWorker()
    vi.stubGlobal('Worker', Worker)
    const { renderInWorker } = await import('./client')
    const a = renderInWorker(song, unlocked, [recording])
    const b = renderInWorker(song, unlocked, [recording])
    const failed = Worker.created[0]
    failed.fail('Out of memory')
    await expect(a).rejects.toThrow('Out of memory')
    await expect(b).rejects.toThrow('Out of memory')
    expect(failed.terminated).toBe(true)

    void renderInWorker(song, unlocked, [recording])
    expect(Worker.created).toHaveLength(2)
    expect(Worker.created[1].received).toHaveLength(1)
  })
})
