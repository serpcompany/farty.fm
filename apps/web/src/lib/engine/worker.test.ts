import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { storedAnalysis } from '../../test-support/engine-golden'
import { bridgedWorker, manualWorker, WorkerScope } from '../../test-support/fake-worker'
import { decoded, goldenRecordings } from '../../test-support/golden'
import { type Arrangement, arrange, autoMapRecording } from './auto-map'
import type { RecordingToRender, RenderedSong } from './render-song'
import { renderFromRecordings } from './render-song'
import type { Song } from './song'
import type { RenderRequest } from './worker'

let recording: RecordingToRender
let song: Song
let unlocked: Arrangement
let locked: Arrangement

beforeAll(async () => {
  const golden = goldenRecordings.find(r => r.id === '090')
  if (!golden?.melodic || golden.recording_pitch_midi === null) throw new Error('090 is Melodic')
  const file = await decoded(golden)
  const analysis = storedAnalysis(golden)
  recording = { id: '090', audio: { samples: file.samples, sampleRate: file.sampleRate }, analysis }
  const nearestNote = Math.round(golden.recording_pitch_midi)
  song = {
    bpm: 120,
    bar_lines: [0],
    length_beats: 2,
    notes: [{ start: 0, dur: 1, pitch: nearestNote }]
  }
  unlocked = arrange(song, [autoMapRecording('090', analysis)])
  locked = arrange(song, [])
  expect(unlocked.unlocked).toBe(true)
  expect(locked.unlocked).toBe(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function startWorker(): Promise<WorkerScope> {
  const scope = new WorkerScope()
  vi.stubGlobal('self', scope)
  await import('./worker')
  return scope
}

async function askAndAwaitReply(scope: WorkerScope, request: RenderRequest) {
  const count = scope.posted.length
  scope.onmessage?.(new MessageEvent('message', { data: request }))
  await vi.waitFor(() => expect(scope.posted.length).toBe(count + 1))
  return scope.posted[count] as {
    message: { id: number; result?: RenderedSong; error?: string }
    transfer: Transferable[]
  }
}

describe('the render worker', () => {
  it('answers by id with the render, and transfers its audio instead of copying it', async () => {
    const scope = await startWorker()
    let onPage: RenderedSong | undefined
    scope.page = { onmessage: event => (onPage = event.data.result) }
    const { message, transfer } = await askAndAwaitReply(scope, {
      id: 7,
      song,
      arrangement: unlocked,
      recordings: [recording]
    })
    expect(message.id).toBe(7)
    expect(message.error).toBeUndefined()
    const rendered = message.result as RenderedSong
    expect(transfer).toEqual([rendered.samples.buffer])
    const detachedOnTheWorkersSide = rendered.samples.buffer.byteLength
    expect(detachedOnTheWorkersSide).toBe(0)
    await vi.waitFor(() => expect(onPage).toBeDefined())
    const direct = renderFromRecordings(song, unlocked, [recording])
    expect(direct.samples.length).toBeGreaterThan(0)
    expect(onPage?.samples).toEqual(direct.samples)
    expect(onPage?.sampleRate).toBe(44100)
    expect(onPage?.notes).toEqual(direct.notes)
  })

  it('answers with the error, and transfers nothing, when the render throws', async () => {
    const scope = await startWorker()
    const { message, transfer } = await askAndAwaitReply(scope, {
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
    expect(first.samples).toEqual(renderFromRecordings(song, unlocked, [recording]).samples)
    expect(second.samples).toEqual(
      renderFromRecordings(later, laterArrangement, [recording]).samples
    )
    expect(second.notes[0].startSample).toBe(first.notes[0].startSample + 22050)
    const pageKeepsItsCopy = recording.audio.samples.buffer.byteLength
    expect(pageKeepsItsCopy).toBeGreaterThan(0)
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
