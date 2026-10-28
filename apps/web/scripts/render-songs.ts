// Renders every Song with the full Fixture Library through the web engine, the way the app does it:
// decode each fixture, run Recording Analysis, Auto-map, then render, with the Noise-like
// Recordings playing the Beats (ADR 0014). The renders are for the reference's checks
// (`tools/melody-lab/evaluate_renders.py`); nothing here ships.
//
//   pnpm exec tsx scripts/render-songs.ts [out-dir]
//
// Writes `<song>.wav` (mono 32-bit float, 44.1 kHz: the renderer's exact output, which Web Audio
// plays as it is) and `<song>.json` (the Song's bpm and transposition, one event per note, and
// one per Beat) to `tools/melody-lab/out/web/` by default, then prints the render time per Song in
// Node.
//
// It first deletes the `.wav` and `.json` files already in the out dir, so no stale render is
// measured again. It exits 1 if a Song that the golden Arrangement unlocks comes out locked.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { toAnalysis } from '../src/lib/analysis/port'
import { analyzeRecording } from '../src/lib/analysis/recording-analysis'
import { type Arrangement, arrange, autoMapRecording } from '../src/lib/engine/auto-map'
import { beatRecordings } from '../src/lib/engine/beats'
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

/** Whether the golden Arrangement on the full library unlocks the Song. */
function goldenUnlocks(id: string): boolean {
  const golden = JSON.parse(readFileSync(join(GOLDEN_ARRANGEMENTS, `${id}.json`), 'utf8')) as {
    unlocked: boolean
  }
  return golden.unlocked
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  // Only the files this script writes: the out dir may be one the caller chose.
  for (const name of readdirSync(outDir)) {
    if (/\.(wav|json)$/.test(name)) rmSync(join(outDir, name))
  }

  // The full Fixture Library, as the manifest lists it (a removed fixture's file can stay in the
  // folder), through Recording Analysis as the app runs it on a new Recording.
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
  const noiseLike = library.filter(r => r.recordingPitchMidi === null).map(r => r.id)
  console.log(
    `${recordings.length} Recordings analysed in ${analysisMs.toFixed(0)} ms; ` +
      `Melodic: ${melodic.join(' ')}; Noise-like: ${noiseLike.join(' ')}`
  )

  // Every Recording, Melodic for the notes and Noise-like for the Beats.
  const sources = new Map<string, RenderSource>()
  const sourceMs = new Map<string, number>()
  for (const r of recordings) {
    const { result, ms } = medianMs(() => renderSource(r.audio, r.analysis))
    sources.set(r.id, result)
    sourceMs.set(r.id, ms)
  }

  const songIds = readdirSync(SONGS)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
  const wronglyLocked: string[] = []
  console.log(
    ['song', 'notes', 'beats', 'T', 'arrange ms', 'render ms', 'worker ms', 'seconds']
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
          `needs ${arrangement.missingNotes.map(m => `${m.midi} (${m.seconds.toFixed(1)} s)`).join(' ')}`
      )
      if (goldenUnlocks(id)) wronglyLocked.push(id)
      continue
    }
    // `render ms` renders from Recordings already cut; `worker ms` is what the render
    // worker runs for one request: cut every Recording the Arrangement and the Beats use, then
    // render.
    const beats = beatRecordings(song, noiseLike)
    const rendered = medianMs(() => renderSong(song, arrangement, sources, beats))
    const worker = medianMs(() => renderFromRecordings(song, arrangement, recordings, beats))
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
        start_s: round(n.startSample / sampleRate, 3),
        len_s: round(n.lengthSamples / sampleRate, 3),
        gain_db: round(n.gainDb, 1)
      })),
      beats: rendered.result.beats.map(b => ({
        beat: b.bar,
        source_id: b.recordingId,
        start_s: round(b.startSample / sampleRate, 3),
        len_s: round(b.lengthSamples / sampleRate, 3),
        gain_db: round(b.gainDb, 1)
      }))
    }
    writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(events, null, 2)}\n`)
    console.log(
      [
        id,
        song.notes.length,
        rendered.result.beats.length,
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
  console.log(`cut each Recording (ms, median of ${RUNS}): ${perSource}`)
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
