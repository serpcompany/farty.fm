import { execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join, basename } from "path";

import { FART_SAMPLES_CACHE_PATH, FART_SAMPLES_DIR } from "./paths.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SampleAnalysis {
  filename: string;
  path: string;
  pitch: number | null;     // spectral centroid frequency in Hz
  midiNote: number | null;  // MIDI note from spectral centroid (kept for compat)
  referenceMidi: number;    // always populated, used for pitch shifting
  loudness: number;         // mean volume in dB (negative number, e.g. -18.3)
  duration: number;         // seconds
  brightness: number;       // 0-1, normalized log position of centroid in F_MIN..F_MAX
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

function readCache(): Map<string, SampleAnalysis> {
  const map = new Map<string, SampleAnalysis>();
  if (!existsSync(FART_SAMPLES_CACHE_PATH)) return map;

  try {
    const raw = readFileSync(FART_SAMPLES_CACHE_PATH, "utf-8");
    const entries: SampleAnalysis[] = JSON.parse(raw);
    for (const entry of entries) {
      map.set(entry.filename, entry);
    }
  } catch {
    // Corrupted cache file, start fresh
  }
  return map;
}

function writeCache(cache: Map<string, SampleAnalysis>): void {
  const entries = Array.from(cache.values());
  writeFileSync(FART_SAMPLES_CACHE_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

function getDuration(filePath: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8" },
    );
    return parseFloat(out.trim()) || 0;
  } catch {
    return 0;
  }
}

function getLoudness(filePath: string): number {
  try {
    const out = execSync(
      `ffmpeg -i "${filePath}" -af volumedetect -f null /dev/null 2>&1`,
      { encoding: "utf-8" },
    );
    const match = out.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    if (match && match[1]) {
      return parseFloat(match[1]);
    }
    return -20;
  } catch {
    return -20;
  }
}

// Goertzel algorithm: measures energy at a specific frequency in a signal
export function goertzelPower(samples: Float32Array, targetFreq: number, sampleRate: number): number {
  const n = Math.min(samples.length, Math.round(sampleRate * 0.5)); // first 0.5s only
  const k = (targetFreq * n) / sampleRate;
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = (samples[i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// Detect spectral centroid using Goertzel algorithm on 20 log-spaced frequency bins
// Returns centroid frequency in Hz and corresponding MIDI note
export function detectSpectralProfile(
  floatArray: Float32Array,
  sampleRate: number,
): { centroidHz: number; midiNote: number; brightness: number } {
  const N_BINS = 20;
  const F_MIN = 80;   // Low bass farts start here
  const F_MAX = 8000; // Squeaky farts go up to here

  let weightedFreq = 0;
  let totalPower = 0;

  for (let i = 0; i < N_BINS; i++) {
    const freq = F_MIN * Math.pow(F_MAX / F_MIN, i / (N_BINS - 1)); // log-spaced
    const power = Math.sqrt(Math.abs(goertzelPower(floatArray, freq, sampleRate))); // sqrt = amplitude
    weightedFreq += freq * power;
    totalPower += power;
  }

  const centroidHz = totalPower > 0 ? weightedFreq / totalPower : 440;
  const clampedHz = Math.max(F_MIN, Math.min(F_MAX, centroidHz));

  // Convert centroid to MIDI note
  const midiNote = Math.round(12 * Math.log2(clampedHz / 440) + 69);

  // Compute brightness: normalized position of centroid within F_MIN..F_MAX on log scale
  const brightness = Math.max(
    0,
    Math.min(1, Math.log2(clampedHz / F_MIN) / Math.log2(F_MAX / F_MIN)),
  );

  return { centroidHz: Math.round(centroidHz * 10) / 10, midiNote, brightness };
}

function analyzeSample(filePath: string): SampleAnalysis {
  const filename = basename(filePath);
  const duration = getDuration(filePath);
  const loudness = getLoudness(filePath);

  // Get PCM data once for spectral analysis
  let spectralResult = { centroidHz: 440, midiNote: 69, brightness: 0.5 };
  try {
    const buffer = execSync(
      `ffmpeg -i "${filePath}" -t 2 -f f32le -acodec pcm_f32le -ar ${SAMPLE_RATE} -ac 1 pipe:1 2>/dev/null`,
      { maxBuffer: SAMPLE_RATE * 4 * 2 + 1024 },
    );
    const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    spectralResult = detectSpectralProfile(floatArray, SAMPLE_RATE);
  } catch {
    // keep defaults
  }

  return {
    filename,
    path: filePath,
    pitch: spectralResult.centroidHz,
    midiNote: spectralResult.midiNote,
    referenceMidi: spectralResult.midiNote,
    loudness,
    duration,
    brightness: spectralResult.brightness,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns analysis for all samples in the samples directory, using cache.
 * Only analyzes samples that aren't already cached.
 */
export function loadSampleAnalyses(): SampleAnalysis[] {
  const cache = readCache();

  const files = readdirSync(FART_SAMPLES_DIR).filter((f) =>
    /\.(wav|mp3|ogg|m4a)$/i.test(f),
  );

  let dirty = false;

  for (const filename of files) {
    if (cache.has(filename)) continue;

    const filePath = join(FART_SAMPLES_DIR, filename);
    const analysis = analyzeSample(filePath);
    cache.set(filename, analysis);
    dirty = true;
  }

  if (dirty) {
    writeCache(cache);
  }

  // Return only analyses for files that currently exist in the directory
  return files
    .map((f) => cache.get(f))
    .filter((a): a is SampleAnalysis => a !== undefined);
}

/**
 * Returns analysis for specific samples by path.
 * Uses cache where available, analyzes and caches any missing.
 */
export function getAnalysesForPaths(paths: string[]): SampleAnalysis[] {
  const cache = readCache();
  const results: SampleAnalysis[] = [];
  let dirty = false;

  for (const filePath of paths) {
    const filename = basename(filePath);
    const cached = cache.get(filename);

    if (cached) {
      results.push(cached);
    } else {
      const analysis = analyzeSample(filePath);
      cache.set(filename, analysis);
      results.push(analysis);
      dirty = true;
    }
  }

  if (dirty) {
    writeCache(cache);
  }

  return results;
}
