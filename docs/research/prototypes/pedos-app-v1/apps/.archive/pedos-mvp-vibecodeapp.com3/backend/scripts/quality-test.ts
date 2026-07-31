#!/usr/bin/env bun
/**
 * Quality test script - compares generated fart melodies against reference sine-wave versions.
 * Run with: cd backend && bun run scripts/quality-test.ts
 */

import { join } from "path";
import { existsSync } from "fs";
import { loadMelody } from "../src/lib/midi-parser.ts";
import { getAnalysesForPaths } from "../src/lib/sample-analyzer.ts";
import { compareAudioQuality } from "../src/lib/audio-compare.ts";

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";

const SAMPLES_DIR = "/home/user/workspace/test-data/fart-samples";
const OUTPUT_DIR = "/tmp/quality-test-output";
mkdirSync(OUTPUT_DIR, { recursive: true });

const BASE_MIDI = 60;

// Must match musical-fruit.ts exactly
function findOptimalTranspose(notes: any[], analyses: any[]): number {
  const sampleMidis = analyses.map((a: any) => a.referenceMidi ?? BASE_MIDI);
  let bestTranspose = 0;
  let bestTotalShift = Infinity;
  for (let t = -5; t <= 5; t++) {  // ±5 semitones — keeps melodies recognizable
    let totalShift = 0;
    for (const note of notes) {
      const targetMidi = note.midi + t;
      const minShift = Math.min(...sampleMidis.map((sm: number) => Math.abs(sm - targetMidi)));
      totalShift += minShift;
    }
    if (totalShift < bestTotalShift) {
      bestTotalShift = totalShift;
      bestTranspose = t;
    }
  }
  return bestTranspose;
}

function generateTestMelody(samplePaths: string[], melodyKey: string): { outputPath: string; transpose: number } {
  const melody = loadMelody(melodyKey);
  if (!melody) throw new Error(`Unknown melody: ${melodyKey}`);

  const analyses = getAnalysesForPaths(samplePaths);
  const transpose = findOptimalTranspose(melody.notes, analyses);
  const notes = melody.notes.map((n: any) => ({ ...n, midi: n.midi + transpose }));

  const jobId = randomUUID().slice(0, 8);
  const jobDir = join(OUTPUT_DIR, jobId);
  mkdirSync(jobDir, { recursive: true });

  const SAMPLE_RATE = 44100;
  const segFiles: string[] = [];
  let segIndex = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;

    // Pick sample: closest referenceMidi to note.midi
    const best = analyses.reduce((prev: any, curr: any) => {
      const prevDist = Math.abs((prev.referenceMidi ?? BASE_MIDI) - note.midi);
      const currDist = Math.abs((curr.referenceMidi ?? BASE_MIDI) - note.midi);
      return currDist < prevDist ? curr : prev;
    });

    const semitoneDiff = note.midi - (best.referenceMidi ?? BASE_MIDI);
    const pitchRatio = Math.pow(2, semitoneDiff / 12);
    const duration = note.duration;

    // Input trimming: match musical-fruit.ts logic
    let inputTrimArg = "";
    let tempoRatio: number;
    if (best.duration < duration) {
      // Sample shorter than note — just stretch (no loop in test script for simplicity)
      tempoRatio = Math.min(Math.max(best.duration / duration, 0.75), 1.5);
    } else {
      // Sample longer — pre-trim to 1.5× note duration (attack only)
      const effectiveInput = Math.min(best.duration, duration * 1.5);
      inputTrimArg = `-t ${effectiveInput.toFixed(4)} `;
      tempoRatio = Math.min(Math.max(effectiveInput / duration, 0.75), 1.5);
    }

    const segFile = join(jobDir, `seg_${String(segIndex).padStart(4, "0")}.wav`);
    segFiles.push(segFile);

    const fartGain = note.velocity.toFixed(4);
    execSync(
      `ffmpeg -y ${inputTrimArg}-i "${best.path}" -af "rubberband=pitch=${pitchRatio}:tempo=${tempoRatio}:transients=crisp:formant=preserved:pitchq=quality,afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, duration - 0.015)}:d=0.015,volume=${fartGain}" -t ${duration} -ar ${SAMPLE_RATE} -ac 1 -sample_fmt s16 "${segFile}" 2>/dev/null`,
    );
    segIndex++;

    const nextNote = notes[i + 1];
    if (nextNote) {
      const restDuration = nextNote.time - (note.time + note.duration);
      if (restDuration > 0.001) {
        const restFile = join(jobDir, `seg_${String(segIndex).padStart(4, "0")}.wav`);
        segFiles.push(restFile);
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=${SAMPLE_RATE}:cl=mono -t ${restDuration} -sample_fmt s16 "${restFile}" 2>/dev/null`);
        segIndex++;
      }
    }
  }

  const concatPath = join(jobDir, "concat.txt");
  writeFileSync(concatPath, segFiles.map((f) => `file '${f}'`).join("\n"), "utf-8");

  const outputPath = join(OUTPUT_DIR, `${melodyKey}_${jobId}.wav`);
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c copy "${outputPath}" 2>/dev/null`);
  execSync(`rm -rf "${jobDir}"`);

  return { outputPath, transpose };
}

// ---- Test cases ----

const TEST_MELODIES = ["twinkle", "happy-birthday", "jingle-bells"];

const TEST_SAMPLE_SETS = [
  {
    label: "All samples",
    paths: [
      "bean-fart.mp3", "fart-1.wav", "fart-4.wav", "trumpet-fart.mp3",
      "long-fart.mp3", "quick-fart.mp3", "fart-7.mp3",
    ].map((f) => join(SAMPLES_DIR, f)),
  },
  {
    label: "Wide range (bass + squeaky)",
    paths: ["bean-fart.mp3", "fart-4.wav"].map((f) => join(SAMPLES_DIR, f)),
  },
  {
    label: "Mid range",
    paths: ["trumpet-fart.mp3", "long-fart.mp3", "quick-fart.mp3"].map((f) => join(SAMPLES_DIR, f)),
  },
];

async function main() {
  console.log("=== Fart Melody Quality Test ===\n");
  console.log("Baseline (before improvements):");
  console.log("  All samples:  Twinkle=33, Happy Birthday=42, Jingle Bells=36");
  console.log("  Wide range:   Twinkle=39, Happy Birthday=50, Jingle Bells=39");
  console.log("  Mid range:    Twinkle=33, Happy Birthday=49, Jingle Bells=36\n");

  for (const sampleSet of TEST_SAMPLE_SETS) {
    console.log(`\nSample set: ${sampleSet.label}`);
    console.log("-".repeat(55));

    for (const melodyKey of TEST_MELODIES) {
      try {
        const melody = loadMelody(melodyKey);
        if (!melody) continue;

        const { outputPath: genPath, transpose } = generateTestMelody(
          sampleSet.paths.filter(p => existsSync(p)),
          melodyKey,
        );

        // CRITICAL FIX: compare against transposed reference (same key as generation)
        const transposedMelody = {
          ...melody,
          notes: melody.notes.map((n) => ({ ...n, midi: n.midi + transpose })),
        };
        const result = await compareAudioQuality(genPath, transposedMelody);

        const transposeStr = transpose >= 0 ? `+${transpose}` : `${transpose}`;
        console.log(
          `  ${melody.name.padEnd(20)} score=${result.score.toString().padStart(3)}  chroma=${result.chromaSimilarity.toFixed(3)}  ${result.label.padEnd(9)} (transpose=${transposeStr})`,
        );

        try { unlinkSync(genPath); } catch { /* ignore */ }
      } catch (err) {
        console.error(`  ${melodyKey}: ERROR - ${err}`);
      }
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
