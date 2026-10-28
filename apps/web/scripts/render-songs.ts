import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { toAnalysis } from '../src/lib/analysis/port'
import { analyzeRecording } from '../src/lib/analysis/recording-analysis'
import { type Arrangement, arrange, autoMapRecording } from '../src/lib/engine/auto-map'
import {
  type RecordingToRender,
  renderFromRecordings,
  renderSong
} from '../src/lib/engine/render-song'
import { renderSource } from '../src/lib/engine/render-source'
import type { RenderSource } from '../src/lib/engine/renderer'
import type { Song } from '../src/lib/engine/song'
import { decodeFile } from '../src/test-support/decode'
import { fixtures } from './fixture-library'

const ROOT = resolve(__dirname, '../../..')
const FIXTURES = join(ROOT, 'fixtures/recordings')
const SONGS = join(ROOT, 'fixtures/golden/songs')
const GOLDEN_ARRANGEMENTS = join(ROOT, 'fixtures/golden/arrangements/full')
const RUNS = 5

const outDir = resolve(process.argv[2] ?? join(ROOT, 'tools/melody-lab/out/web'))

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function time<T>(run: () => T): { result: T; ms: number } {
  const started = performance.now()
  const result = run()
  return { result, ms: performance.now() - started }
}

function medianMsAfterWarmUp<T>(run: () => T): { result: T; ms: number } {
  const result = run()
  const runs: number[] = []
  for (let k = 0; k < RUNS; k++) runs.push(time(run).ms)
  return { result, ms: median(runs) }
}

const WAVE_FORMAT_IEEE_FLOAT = 3
const MONO = 1

function float32Wav(samples: Float32Array, sampleRate: number): Buffer {
  const data = samples.length * 4
  const out = Buffer.alloc(44 + data)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + data, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(WAVE_FORMAT_IEEE_FLOAT, 20)
  out.writeUInt16LE(MONO, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * 4, 28)
  out.writeUInt16LE(4, 32)
  out.writeUInt16LE(32, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(data, 40)
  for (let i = 0; i < samples.length; i++) out.writeFloatLE(samples[i], 44 + i * 4)
  return out
}

const round = (x: number, digits: number) => Number(x.toFixed(digits))

function goldenUnlocks(id: string): boolean {
  const golden = JSON.parse(readFileSync(join(GOLDEN_ARRANGEMENTS, `${id}.json`), 'utf8')) as {
    unlocked: boolean
  }
  return golden.unlocked
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  for (const name of readdirSync(outDir)) {
    if (/\.(wav|json)$/.test(name)) rmSync(join(outDir, name))
  }

  const recordings: RecordingToRender[] = []
  let analysisMs = 0
  for (const { id, filename } of fixtures()) {
    const file = await decodeFile(join(FIXTURES, filename))
    const audio = { samples: file.samples, sampleRate: file.sampleRate }
    const { result, ms } = time(() => toAnalysis(analyzeRecording(audio.samples, audio.sampleRate)))
    analysisMs += ms
    recordings.push({ id, audio, analysis: result })
  }
  const library = recordings.map(r => autoMapRecording(r.id, r.analysis))
  const melodic = library.filter(r => r.recordingPitchMidi !== null).map(r => r.id)
  console.log(
    `${recordings.length} Recordings analysed in ${analysisMs.toFixed(0)} ms; ` +
      `Melodic: ${melodic.join(' ')}`
  )

  const sources = new Map<string, RenderSource>()
  const sourceMs = new Map<string, number>()
  for (const r of recordings) {
    if (r.analysis.recordingPitchMidi === null) continue
    const { result, ms } = medianMsAfterWarmUp(() => renderSource(r.audio, r.analysis))
    sources.set(r.id, result)
    sourceMs.set(r.id, ms)
  }

  const songIds = readdirSync(SONGS)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
  const wronglyLocked: string[] = []
  console.log(
    ['song', 'notes', 'T', 'arrange ms', 'render ms', 'worker ms', 'seconds']
      .map(c => c.padEnd(13))
      .join('')
  )
  for (const id of songIds) {
    const song = JSON.parse(readFileSync(join(SONGS, `${id}.json`), 'utf8')) as Song
    const planned = medianMsAfterWarmUp(() => arrange(song, library))
    const arrangement: Arrangement = planned.result
    if (!arrangement.unlocked) {
      console.log(
        `${id.padEnd(13)}locked: ${arrangement.covered} of ${arrangement.total} notes covered, ` +
          `needs ${arrangement.missingNotes.map(m => `${m.midi} (${m.seconds.toFixed(1)} s)`).join(' ')}`
      )
      if (goldenUnlocks(id)) wronglyLocked.push(id)
      continue
    }
    const renderedFromCutRecordings = medianMsAfterWarmUp(() =>
      renderSong(song, arrangement, sources)
    )
    const renderedAsTheWorkerDoes = medianMsAfterWarmUp(() =>
      renderFromRecordings(song, arrangement, recordings)
    )
    const { samples, sampleRate, notes } = renderedFromCutRecordings.result
    writeFileSync(join(outDir, `${id}.wav`), float32Wav(samples, sampleRate))
    const events = {
      song: id,
      bpm: song.bpm,
      transpose: arrangement.transposition,
      octave_moves: arrangement.octaveMoves,
      plan_cost: arrangement.cost,
      timing_ms: {
        arrange: round(planned.ms, 2),
        render: round(renderedFromCutRecordings.ms, 2),
        worker: round(renderedAsTheWorkerDoes.ms, 2),
        runs: RUNS
      },
      notes: notes.map(n => ({
        note_index: n.noteIndex,
        source_id: n.recordingId,
        target_midi: n.targetMidi,
        start_s: round(n.startSample / sampleRate, 3),
        len_s: round(n.lengthSamples / sampleRate, 3),
        gain_db: round(n.gainDb, 1)
      }))
    }
    writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(events, null, 2)}\n`)
    console.log(
      [
        id,
        song.notes.length,
        arrangement.transposition,
        planned.ms.toFixed(1),
        renderedFromCutRecordings.ms.toFixed(0),
        renderedAsTheWorkerDoes.ms.toFixed(0),
        (samples.length / sampleRate).toFixed(1)
      ]
        .map(c => String(c).padEnd(13))
        .join('')
    )
  }
  const perSource = [...sourceMs].map(([id, ms]) => `${id} ${ms.toFixed(0)}`).join(', ')
  console.log(`cut each Melodic Recording (ms, median of ${RUNS}): ${perSource}`)
  console.log(`wrote ${outDir}`)
  if (wronglyLocked.length > 0) {
    console.error(`locked here, but the golden Arrangement unlocks it: ${wronglyLocked.join(' ')}`)
    process.exit(1)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
