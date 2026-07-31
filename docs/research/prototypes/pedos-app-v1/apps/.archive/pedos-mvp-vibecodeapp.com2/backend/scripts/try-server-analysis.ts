#!/usr/bin/env bun

import { execSync } from "child_process";
import { basename, join } from "path";
import { readdirSync } from "fs";
import { PitchDetector } from "pitchy";

import { loadAllMelodies } from "../src/lib/midi-parser.ts";
import { FART_SAMPLES_DIR } from "../src/lib/paths.ts";
import {
  aggregatePitchFrames,
  scoreMelodyFit,
  type PrototypeSampleProfile,
} from "../src/lib/prototype-pitch-profile.ts";
import { loadSampleAnalyses } from "../src/lib/sample-analyzer.ts";

interface AnalyzedSample extends PrototypeSampleProfile {
  filename: string;
  path: string;
}

interface PrototypeSampleSet {
  label: string;
  profiles: AnalyzedSample[];
}

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const SAMPLE_RATE = 22050;
const MAX_ANALYSIS_SECONDS = 4;

function computeRms(samples: Float32Array): number {
  if (!samples.length) {
    return 0;
  }

  let total = 0;

  for (const sample of samples) {
    total += sample * sample;
  }

  return Math.sqrt(total / samples.length);
}

function decodeMonoPcm(filePath: string): Float32Array {
  const buffer = execSync(
    `ffmpeg -i "${filePath}" -t ${MAX_ANALYSIS_SECONDS} -f f32le -acodec pcm_f32le -ar ${SAMPLE_RATE} -ac 1 pipe:1 2>/dev/null`,
    {
      maxBuffer: SAMPLE_RATE * 4 * MAX_ANALYSIS_SECONDS + 1024,
    },
  );

  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function analyzeSample(filePath: string): AnalyzedSample {
  const detector = PitchDetector.forFloat32Array(FRAME_SIZE);
  detector.clarityThreshold = 0.8;
  detector.minVolumeDecibels = -30;

  const pcm = decodeMonoPcm(filePath);
  const frames: Array<{ clarity: number; hz: number; rms: number }> = [];

  for (let index = 0; index + FRAME_SIZE <= pcm.length; index += HOP_SIZE) {
    const frame = pcm.subarray(index, index + FRAME_SIZE);
    const rms = computeRms(frame);
    const [hz, clarity] = detector.findPitch(frame, SAMPLE_RATE);

    frames.push({
      clarity,
      hz,
      rms,
    });
  }

  return {
    ...aggregatePitchFrames(frames),
    filename: basename(filePath),
    path: filePath,
  };
}

function sortByReferenceMidi(samples: AnalyzedSample[]): AnalyzedSample[] {
  return samples.slice().sort((left, right) => {
    const leftMidi = left.referenceMidi ?? Number.POSITIVE_INFINITY;
    const rightMidi = right.referenceMidi ?? Number.POSITIVE_INFINITY;
    return leftMidi - rightMidi;
  });
}

function pickEvenlySpaced(samples: AnalyzedSample[], count: number): AnalyzedSample[] {
  if (count <= 0 || samples.length === 0) {
    return [];
  }

  if (count >= samples.length) {
    return samples;
  }

  const picks: AnalyzedSample[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < count; index++) {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    const sampleIndex = Math.round(ratio * (samples.length - 1));
    const sample = samples[sampleIndex];

    if (!sample || seen.has(sample.filename)) {
      continue;
    }

    seen.add(sample.filename);
    picks.push(sample);
  }

  return picks;
}

function pickMidRange(samples: AnalyzedSample[], count: number): AnalyzedSample[] {
  if (count <= 0 || samples.length === 0) {
    return [];
  }

  if (count >= samples.length) {
    return samples;
  }

  const startIndex = Math.max(0, Math.floor((samples.length - count) / 2));
  return samples.slice(startIndex, startIndex + count);
}

function buildPrototypeSampleSets(samples: AnalyzedSample[]): PrototypeSampleSet[] {
  const pitchedSamples = sortByReferenceMidi(samples.filter((sample) => sample.referenceMidi !== null));

  return [
    {
      label: "All samples",
      profiles: pickEvenlySpaced(pitchedSamples, Math.min(7, pitchedSamples.length)),
    },
    {
      label: "Wide range (bass + squeaky)",
      profiles: pickEvenlySpaced(pitchedSamples, Math.min(3, pitchedSamples.length)),
    },
    {
      label: "Mid range",
      profiles: pickMidRange(pitchedSamples, Math.min(3, pitchedSamples.length)),
    },
  ];
}

function formatMaybeNumber(value: number | null, digits = 0): string {
  if (value === null) {
    return "-";
  }

  return digits ? value.toFixed(digits) : `${Math.round(value)}`;
}

function printProfileComparison(samples: AnalyzedSample[]): void {
  const currentByFilename = new Map(
    loadSampleAnalyses().map((analysis) => [analysis.filename, analysis.referenceMidi]),
  );

  const deltas = samples
    .filter((sample) => sample.referenceMidi !== null)
    .map((sample) => ({
      currentMidi: currentByFilename.get(sample.filename) ?? null,
      delta: sample.referenceMidi === null || currentByFilename.get(sample.filename) === undefined
        ? 0
        : Math.abs(sample.referenceMidi - (currentByFilename.get(sample.filename) ?? sample.referenceMidi)),
      sample,
    }))
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 8);

  console.log("\nBiggest prototype vs current-note deltas:");
  for (const item of deltas) {
    console.log(
      `  ${item.sample.filename}: current=${formatMaybeNumber(item.currentMidi)} prototype=${formatMaybeNumber(item.sample.referenceMidi)} confidence=${item.sample.pitchConfidence.toFixed(2)} range=${formatMaybeNumber(item.sample.usableMinMidi)}-${formatMaybeNumber(item.sample.usableMaxMidi)}`,
    );
  }
}

function printSampleSummary(samples: AnalyzedSample[]): void {
  const pitchedSamples = samples.filter((sample) => sample.referenceMidi !== null);
  const strongestSamples = pitchedSamples
    .slice()
    .sort((left, right) => right.pitchConfidence - left.pitchConfidence)
    .slice(0, 8);

  console.log("Top confident prototype profiles:");
  for (const sample of strongestSamples) {
    console.log(
      `  ${sample.filename}: midi=${formatMaybeNumber(sample.referenceMidi)} confidence=${sample.pitchConfidence.toFixed(2)} range=${formatMaybeNumber(sample.usableMinMidi)}-${formatMaybeNumber(sample.usableMaxMidi)}`,
    );
  }

  console.log(`\nConfident pitched samples: ${pitchedSamples.length}/${samples.length}`);
}

function printMelodyFits(sampleSets: PrototypeSampleSet[]): void {
  const melodies = loadAllMelodies();

  for (const sampleSet of sampleSets) {
    const ranked = melodies
      .map((melody) => ({
        fit: scoreMelodyFit(
          sampleSet.profiles,
          melody.notes.map((note) => note.midi),
        ),
        melody,
      }))
      .sort((left, right) => right.fit.matchScore - left.fit.matchScore)
      .slice(0, 5);

    console.log(`\nSample set: ${sampleSet.label}`);
    console.log(`  Files: ${sampleSet.profiles.map((profile) => profile.filename).join(", ")}`);

    for (const item of ranked) {
      console.log(
        `  ${item.melody.name}: score=${item.fit.matchScore} transpose=${item.fit.bestTranspose >= 0 ? "+" : ""}${item.fit.bestTranspose} risks=${item.fit.riskNotes.length}`,
      );
    }
  }
}

function main(): void {
  const filePaths = readdirSync(FART_SAMPLES_DIR)
    .filter((filename) => /\.(wav|mp3|ogg|m4a)$/i.test(filename))
    .map((filename) => join(FART_SAMPLES_DIR, filename));

  console.log("=== Prototype Server Analysis ===");
  console.log(`Samples directory: ${FART_SAMPLES_DIR}`);
  console.log(`Files analyzed: ${filePaths.length}`);

  const analyzedSamples = filePaths.map((filePath) => analyzeSample(filePath));
  const sampleSets = buildPrototypeSampleSets(analyzedSamples);

  printSampleSummary(analyzedSamples);
  printProfileComparison(analyzedSamples);
  printMelodyFits(sampleSets);
}

main();
