// Renders every Song with the full Fixture Library through the web engine, the way the app does it:
// decode each fixture, run Recording Analysis, Auto-map, then render. The renders are for the
// reference's checks (`tools/melody-lab/evaluate_renders.py`); nothing here ships.
//
//   pnpm exec tsx scripts/render-songs.ts [out-dir]
//
// Writes `<song>.wav` (mono 32-bit float, 44.1 kHz: the renderer's exact output, which Web Audio
// plays as it is) and `<song>.json` (the Song's bpm and transposition, and one event per note) to
// `tools/melody-lab/out/web/` by default, then prints the render time per Song in Node.
//
// It first deletes the `.wav` and `.json` files already in the out dir, so no stale render is
// measured again. It exits 1 if a Song that the golden Arrangement unlocks comes out locked.
//
//   pnpm exec tsx scripts/render-songs.ts --scenario ../../tools/melody-lab/scenarios/trim-065.json [out-dir]
//
// renders with a Scenario's library instead, into `tools/melody-lab/out/web-<id>/` by default: the
// fixtures it lists, each trimmed between its handles (`trimBounds`, ADR 0019) and placed on its
// note by ear (ADR 0015) as the app does it. `evaluate_renders.py --scenario` checks them; nothing
// is compared with golden here.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { toAnalysis } from '../src/lib/analysis/port'
import { analyzeRecording } from '../src/lib/analysis/recording-analysis'
import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '../src/lib/analysis/resample'
import { trimBounds } from '../src/lib/analysis/trimming'
import {
  type Arrangement,
  type AutoMapRecording,
  arrange,
  autoMapRecording,
  placedAutoMapRecording
} from '../src/lib/engine/auto-map'
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

/** A Scenario (`tools/melody-lab/scenarios/`): fixtures, where each is placed, and its handles. */
type Scenario = {
  id: string
  library: string[]
  placed?: Record<string, number>
  trims?: Record<string, [number, number]>
}

const args = process.argv.slice(2)
const scenarioAt = args.indexOf('--scenario')
const scenario: Scenario | null =
  scenarioAt === -1 ? null : JSON.parse(readFileSync(resolve(args[scenarioAt + 1]), 'utf8'))
const outArg = args.filter((_, i) => i !== scenarioAt && i !== scenarioAt + 1)[0]
const outDir = resolve(
  outArg ??
    join(ROOT, scenario ? `tools/melody-lab/out/web-${scenario.id}` : 'tools/melody-lab/out/web')
)

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
    if (scenario && !scenario.library.includes(id)) continue
    const file = await decodeFile(join(FIXTURES, filename))
    const audio = { samples: file.samples, sampleRate: file.sampleRate }
    const { result, ms } = time(() => toAnalysis(analyzeRecording(audio.samples, audio.sampleRate)))
    analysisMs += ms
    const handles = scenario?.trims?.[id]
    if (!handles) {
      recordings.push({ id, audio, analysis: result })
      continue
    }
    // As the picker's Save trim finds it, in the analysis worker.
    const y = resampleToAnalysisRate(audio.samples, audio.sampleRate)
    const trim = trimBounds(y, handles[0], handles[1])
    const sr = ANALYSIS_SAMPLE_RATE
    console.log(
      `${id} trimmed between ${handles[0]} and ${handles[1]} s: samples ` +
        `${Math.round(trim.startSeconds * sr)} to ${Math.round(trim.endSeconds * sr)} ` +
        `(${trim.startSeconds.toFixed(4)} to ${trim.endSeconds.toFixed(4)} s); analysis found ` +
        `${Math.round(result.gestureStartSeconds * sr)} to ${Math.round(result.gestureEndSeconds * sr)}`
    )
    recordings.push({ id, audio, analysis: result, trim })
  }
  // As `autoMapRecordings` in `pitch-coverage.ts` reads them: Melodic ones, and placed ones.
  const library: AutoMapRecording[] = recordings.flatMap(r => {
    const placed = scenario?.placed?.[r.id]
    if (placed !== undefined) return [placedAutoMapRecording(r.id, r.analysis, placed, r.trim)]
    return r.analysis.recordingPitchMidi === null ? [] : [autoMapRecording(r.id, r.analysis)]
  })
  console.log(
    `${recordings.length} Recordings analysed in ${analysisMs.toFixed(0)} ms; ` +
      `Melodic or placed: ${library.map(r => r.id).join(' ')}`
  )

  const sources = new Map<string, RenderSource>()
  const sourceMs = new Map<string, number>()
  for (const r of recordings) {
    if (!library.some(l => l.id === r.id)) continue
    const { result, ms } = medianMs(() => renderSource(r.audio, r.analysis, r.trim ?? null))
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
    const planned = medianMs(() => arrange(song, library))
    const arrangement: Arrangement = planned.result
    if (!arrangement.unlocked) {
      console.log(
        `${id.padEnd(13)}locked: ${arrangement.covered} of ${arrangement.total} notes covered, ` +
          `needs ${arrangement.missingNotes.map(m => `${m.midi} (${m.seconds.toFixed(1)} s)`).join(' ')}`
      )
      if (!scenario && goldenUnlocks(id)) wronglyLocked.push(id)
      continue
    }
    // `render ms` renders from Recordings already cut; `worker ms` is what the render
    // worker runs for one request: cut every Recording the Arrangement uses, then render.
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
        start_s: round(n.startSample / sampleRate, 3),
        len_s: round(n.lengthSamples / sampleRate, 3),
        gain_db: round(n.gainDb, 1),
        lead_s: round(n.leadSamples / sampleRate, 3)
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
  console.log(`cut each Melodic or placed Recording (ms, median of ${RUNS}): ${perSource}`)
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
