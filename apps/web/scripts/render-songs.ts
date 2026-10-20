// Renders every Song with the full Fixture Library through the web engine, the way the app does it:
// decode each fixture, run Recording Analysis, Auto-map, then render. The renders are for the
// reference's checks (`tools/melody-lab/evaluate_renders.py`); nothing here ships.
//
//   pnpm exec tsx scripts/render-songs.ts [out-dir]
//
// Writes `<song>.wav` (mono 32-bit float, 44.1 kHz: the renderer's exact output, which Web Audio
// plays as it is) and `<song>.json` (the Song's bpm and transposition, and one event per note) to
// `tools/melody-lab/out/web/` by default, then prints the render time per Song in Node.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const ROOT = resolve(__dirname, '../../..')
const FIXTURES = join(ROOT, 'fixtures/recordings')
const SONGS = join(ROOT, 'fixtures/golden/songs')
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

/** The median of `RUNS` timed runs, after one untimed warm-up run. */
function medianMs<T>(run: () => T): { result: T; ms: number } {
  const result = run()
  const runs: number[] = []
  for (let k = 0; k < RUNS; k++) runs.push(time(run).ms)
  return { result, ms: median(runs) }
}

/** A mono WAV of 32-bit IEEE floats, so the reference reads exactly the samples the app plays. */
function floatWav(samples: Float32Array, sampleRate: number): Buffer {
  const data = samples.length * 4
  const out = Buffer.alloc(44 + data)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + data, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(3, 20) // WAVE_FORMAT_IEEE_FLOAT
  out.writeUInt16LE(1, 22)
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

async function main() {
  mkdirSync(outDir, { recursive: true })

  // The full Fixture Library, through Recording Analysis as the app runs it on a new Recording.
  const files = readdirSync(FIXTURES)
    .filter(name => /^\d{3}__/.test(name))
    .sort()
  const recordings: RecordingToRender[] = []
  let analysisMs = 0
  for (const name of files) {
    const file = await decodeFile(join(FIXTURES, name))
    const audio = { samples: file.samples, sampleRate: file.sampleRate }
    const { result, ms } = time(() => toAnalysis(analyzeRecording(audio.samples, audio.sampleRate)))
    analysisMs += ms
    recordings.push({ id: name.slice(0, 3), audio, analysis: result })
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
    const { result, ms } = medianMs(() => renderSource(r.audio, r.analysis))
    sources.set(r.id, result)
    sourceMs.set(r.id, ms)
  }

  const songIds = readdirSync(SONGS)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
  console.log(
    ['song', 'notes', 'T', 'arrange ms', 'render ms', 'worker ms', 'seconds']
      .map(c => c.padEnd(13))
      .join('')
  )
  for (const id of songIds) {
    const song = JSON.parse(readFileSync(join(SONGS, `${id}.json`), 'utf8')) as Song
    const planned = medianMs(() => arrange(song, library))
    const arrangement: Arrangement = planned.result
    if (!arrangement.unlocked) {
      console.log(
        `${id.padEnd(13)}locked: ${arrangement.covered} of ${arrangement.total} notes covered, ` +
          `needs ${arrangement.missingNotes.join(' ')}`
      )
      continue
    }
    // `render ms` renders from Recordings already cut and tracked; `worker ms` is what the render
    // worker runs for one request: cut every Recording the Arrangement uses, track it, render.
    const rendered = medianMs(() => renderSong(song, arrangement, sources))
    const worker = medianMs(() => renderFromRecordings(song, arrangement, recordings))
    const { samples, sampleRate, notes } = rendered.result
    writeFileSync(join(outDir, `${id}.wav`), floatWav(samples, sampleRate))
    const events = {
      song: id,
      bpm: song.bpm,
      transpose: arrangement.transposition,
      octave_moves: arrangement.octaveMoves,
      plan_cost: arrangement.cost,
      timing_ms: {
        arrange: round(planned.ms, 2),
        render: round(rendered.ms, 2),
        worker: round(worker.ms, 2),
        runs: RUNS
      },
      notes: notes.map(n => ({
        note_index: n.noteIndex,
        source_id: n.recordingId,
        target_midi: n.targetMidi,
        shift_semitones: n.shiftSemitones,
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
        rendered.ms.toFixed(0),
        worker.ms.toFixed(0),
        (samples.length / sampleRate).toFixed(1)
      ]
        .map(c => String(c).padEnd(13))
        .join('')
    )
  }
  const perSource = [...sourceMs].map(([id, ms]) => `${id} ${ms.toFixed(0)}`).join(', ')
  console.log(`cut and track each Melodic Recording (ms, median of ${RUNS}): ${perSource}`)
  console.log(`wrote ${outDir}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
