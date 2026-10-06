import { expect, test } from 'vitest'
import { decoded, gestureBody, goldenRecordings } from '../../test-support/golden'
import { NOTE_LENGTHS, readBackCents } from './audition'
import { analyzeRecording } from './recording-analysis'
import { analyzePitch } from './recording-pitch'
import { ANALYSIS_SAMPLE_RATE } from './resample'
import { noteSegment } from './trimming'

// Timings in Node (V8, the engine Chrome's Web Workers run). The budget is the Swift one: under
// 1 s for a 5 s Recording. Each is the median of 7 runs after a warm-up run.
const RUNS = 7

function median(times: number[]): number {
  const s = [...times].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function time(run: () => void): number {
  run()
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    run()
    times.push(performance.now() - t0)
  }
  return median(times)
}

test('analyzeRecording on the longest fixtures and typical clips', async () => {
  const fixture = (id: string) => {
    const golden = goldenRecordings.find(g => g.id === id)
    if (!golden) throw new Error(`fixture ${id} missing`)
    return golden
  }
  const lines: string[] = []
  // 094: the longest file (4.75 s at 44.1 kHz). 002: the longest 48 kHz file (4.21 s), so it
  // includes resampling. 080, 084, 065: typical 2–3 s clips; 080 has the longest gesture (2 s).
  for (const id of ['094', '002', '080', '084', '065']) {
    const golden = fixture(id)
    const file = await decoded(golden)
    const ms = time(() => analyzeRecording(file.samples, file.sampleRate))
    const seconds = file.frames / file.sampleRate
    const gesture = (golden.gesture.end_sample - golden.gesture.start_sample) / ANALYSIS_SAMPLE_RATE
    lines.push(
      `${id}: ${seconds.toFixed(2)} s file at ${file.sampleRate} Hz, ${gesture.toFixed(2)} s gesture, ${golden.melodic ? 'Melodic' : 'Noise-like'}: ${ms.toFixed(1)} ms`
    )
    expect(ms).toBeLessThan(1000)
  }
  console.log(
    `Timing (Node ${process.version}), analyzeRecording, median of ${RUNS}:\n${lines.join('\n')}`
  )
})

// The worst case for a 5 s Recording (as in TimingTests.swift): the whole 5 s is one gesture, so
// pYIN runs over all of it, and audition renders and reads back all four note lengths. The input
// is a fixture's gesture repeated to 5 s in memory; it is test input only and is never played.
test('a 5 s gesture, worst case', async () => {
  const golden = goldenRecordings.find(g => g.id === '059')
  if (!golden) throw new Error('fixture 059 missing')
  const gesture = await gestureBody(golden)
  const body = Float64Array.from(
    { length: 5 * ANALYSIS_SAMPLE_RATE },
    (_, i) => gesture[i % gesture.length]
  )
  const samples = Float32Array.from(body)
  const stages = { trimming: [] as number[], pitch: [] as number[], audition: [] as number[] }
  const totals: number[] = []
  for (let run = 0; run <= RUNS; run++) {
    const t0 = performance.now()
    noteSegment(samples)
    const t1 = performance.now()
    const pitch = analyzePitch(body)
    const t2 = performance.now()
    for (const length of NOTE_LENGTHS) {
      readBackCents(body, pitch.f0, pitch.estimateMidi ?? 60, length)
    }
    const t3 = performance.now()
    if (run === 0) continue // warm-up
    stages.trimming.push(t1 - t0)
    stages.pitch.push(t2 - t1)
    stages.audition.push(t3 - t2)
    totals.push(t3 - t0)
  }
  const total = median(totals)
  console.log(
    `Timing (Node ${process.version}), 5 s gesture worst case, median of ${RUNS}: ${total.toFixed(1)} ms (trimming ${median(stages.trimming).toFixed(1)}, pitch contour ${median(stages.pitch).toFixed(1)}, audition of all 4 note lengths ${median(stages.audition).toFixed(1)})`
  )
  expect(total).toBeLessThan(1000)
})
