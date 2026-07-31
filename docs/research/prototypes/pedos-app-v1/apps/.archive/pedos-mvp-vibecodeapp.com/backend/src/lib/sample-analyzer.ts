import { execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join, basename } from "path";
import * as pitchfinder from "pitchfinder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SampleAnalysis {
  filename: string;
  path: string;
  pitch: number | null; // detected frequency in Hz (null if undetectable)
  midiNote: number | null; // nearest MIDI note number (null if pitch undetectable)
  loudness: number; // mean volume in dB (negative number, e.g. -18.3)
  duration: number; // seconds
  brightness: number; // 0-1, ratio of high-freq to total energy (1 = squeaky, 0 = bassy)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLES_DIR = "/home/user/workspace/test-data/fart-samples";
const CACHE_PATH = "/home/user/workspace/test-data/fart-samples/analysis.json";
const SAMPLE_RATE = 44100;

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

function readCache(): Map<string, SampleAnalysis> {
  const map = new Map<string, SampleAnalysis>();
  if (!existsSync(CACHE_PATH)) return map;

  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
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
  writeFileSync(CACHE_PATH, JSON.stringify(entries, null, 2), "utf-8");
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

function detectPitch(filePath: string): { pitch: number | null; midiNote: number | null } {
  try {
    // Convert to raw 32-bit float PCM, mono, 44100Hz, first 2 seconds
    const buffer = execSync(
      `ffmpeg -i "${filePath}" -t 2 -f f32le -acodec pcm_f32le -ar ${SAMPLE_RATE} -ac 1 pipe:1 2>/dev/null`,
      { maxBuffer: SAMPLE_RATE * 4 * 2 + 1024 }, // 2 seconds of f32le at 44100Hz
    );

    const floatArray = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4,
    );

    const detect = pitchfinder.YIN({ sampleRate: SAMPLE_RATE });
    const frequency = detect(floatArray);

    if (frequency == null || !isFinite(frequency) || frequency <= 0) {
      return { pitch: null, midiNote: null };
    }

    const midiNote = Math.round(12 * Math.log2(frequency / 440) + 69);
    return { pitch: Math.round(frequency * 10) / 10, midiNote };
  } catch {
    return { pitch: null, midiNote: null };
  }
}

function detectBrightness(filePath: string): number {
  try {
    // Get raw PCM data (first 2 seconds, mono, 44100Hz)
    const buffer = execSync(
      `ffmpeg -i "${filePath}" -t 2 -f f32le -acodec pcm_f32le -ar ${SAMPLE_RATE} -ac 1 pipe:1 2>/dev/null`,
      { maxBuffer: SAMPLE_RATE * 4 * 2 + 1024 },
    );

    const floatArray = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4,
    );

    // Simple spectral brightness: ratio of zero-crossings to total samples
    // More zero crossings = higher frequency content = brighter/squeakier
    let zeroCrossings = 0;
    for (let i = 1; i < floatArray.length; i++) {
      if (
        (floatArray[i]! >= 0 && floatArray[i - 1]! < 0) ||
        (floatArray[i]! < 0 && floatArray[i - 1]! >= 0)
      ) {
        zeroCrossings++;
      }
    }

    // Normalize: typical speech ~1000-3000 crossings/sec, farts vary widely
    // Divide by sample count to get rate, then scale to 0-1
    const rate = zeroCrossings / floatArray.length;
    // rate of ~0.5 = Nyquist (max), typical audio 0.01-0.15
    // Clamp and scale: 0.01 → 0, 0.15 → 1
    const brightness = Math.max(0, Math.min(1, (rate - 0.01) / 0.14));
    return Math.round(brightness * 100) / 100;
  } catch {
    return 0.5; // default middle brightness
  }
}

function analyzeSample(filePath: string): SampleAnalysis {
  const filename = basename(filePath);
  const duration = getDuration(filePath);
  const loudness = getLoudness(filePath);
  const { pitch, midiNote } = detectPitch(filePath);
  const brightness = detectBrightness(filePath);

  return {
    filename,
    path: filePath,
    pitch,
    midiNote,
    loudness,
    duration,
    brightness,
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

  const files = readdirSync(SAMPLES_DIR).filter((f) =>
    /\.(wav|mp3|ogg|m4a)$/i.test(f),
  );

  let dirty = false;

  for (const filename of files) {
    if (cache.has(filename)) continue;

    const filePath = join(SAMPLES_DIR, filename);
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
