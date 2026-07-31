import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import Meyda from "meyda";
import WavDecoder from "wav-decoder";
import type { ParsedMelody } from "./midi-parser.ts";
import { AUDIO_COMPARE_TMP_DIR } from "./paths.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const FRAME_SIZE = 4096; // ~93ms windows — good frequency resolution for chroma
const HOP_SIZE = 2048;   // 50% overlap
if (!existsSync(AUDIO_COMPARE_TMP_DIR)) {
  mkdirSync(AUDIO_COMPARE_TMP_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) * (a[i] ?? 0);
    magB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

// ---------------------------------------------------------------------------
// Reference melody generation (pure sine waves)
// ---------------------------------------------------------------------------

/**
 * Generate a reference WAV from a parsed melody using pure sine waves.
 * Returns path to the generated WAV file (caller must delete when done).
 */
export function generateReferenceMelody(melody: ParsedMelody): string {
  const jobId = randomUUID().slice(0, 8);
  const jobDir = join(AUDIO_COMPARE_TMP_DIR, jobId);
  mkdirSync(jobDir, { recursive: true });

  const segFiles: string[] = [];
  let segIndex = 0;

  for (let i = 0; i < melody.notes.length; i++) {
    const note = melody.notes[i]!;
    const freq = midiToHz(note.midi);
    const segFile = join(jobDir, `seg_${String(segIndex).padStart(4, "0")}.wav`);
    segFiles.push(segFile);

    // Sine wave for this note, with slight fade in/out to avoid clicks
    execSync(
      `ffmpeg -y -f lavfi -i "sine=frequency=${freq.toFixed(3)}:sample_rate=${SAMPLE_RATE}" -af "volume=${note.velocity},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, note.duration - 0.01)}:d=0.01" -t ${note.duration} -ar ${SAMPLE_RATE} -ac 1 -sample_fmt s16 "${segFile}" 2>/dev/null`,
    );
    segIndex++;

    // Rest between notes
    const nextNote = melody.notes[i + 1];
    if (nextNote) {
      const restDuration = nextNote.time - (note.time + note.duration);
      if (restDuration > 0.001) {
        const restFile = join(jobDir, `seg_${String(segIndex).padStart(4, "0")}.wav`);
        segFiles.push(restFile);
        execSync(
          `ffmpeg -y -f lavfi -i anullsrc=r=${SAMPLE_RATE}:cl=mono -t ${restDuration} -sample_fmt s16 "${restFile}" 2>/dev/null`,
        );
        segIndex++;
      }
    }
  }

  const concatPath = join(jobDir, "concat.txt");
  writeFileSync(concatPath, segFiles.map((f) => `file '${f}'`).join("\n"), "utf-8");

  const outputPath = join(AUDIO_COMPARE_TMP_DIR, `ref_${jobId}.wav`);
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c copy "${outputPath}" 2>/dev/null`,
  );

  // Cleanup temp segments
  for (const f of segFiles) { try { unlinkSync(f); } catch { /* ignore */ } }
  try { unlinkSync(concatPath); } catch { /* ignore */ }
  try { execSync(`rm -rf "${jobDir}"`); } catch { /* ignore */ }

  return outputPath;
}

// ---------------------------------------------------------------------------
// Chroma extraction
// ---------------------------------------------------------------------------

async function extractChromaFrames(wavPath: string): Promise<number[][]> {
  const buffer = readFileSync(wavPath);
  const audio = await WavDecoder.decode(buffer);
  const samples: Float32Array = audio.channelData[0]!;

  // Resample to SAMPLE_RATE if needed (ffmpeg already handles this, but double-check)
  const frames: number[][] = [];

  for (let i = 0; i + FRAME_SIZE <= samples.length; i += HOP_SIZE) {
    const frame = samples.slice(i, i + FRAME_SIZE);
    const chroma = Meyda.extract("chroma", frame);
    if (chroma && Array.isArray(chroma)) {
      frames.push(Array.from(chroma));
    }
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Quality comparison
// ---------------------------------------------------------------------------

export interface QualityResult {
  chromaSimilarity: number; // 0-1, mean cosine similarity of chroma frames
  score: number;            // 0-100 overall quality score
  label: string;            // "Excellent" | "Good" | "Fair" | "Poor"
  frameCount: number;       // number of frames compared
}

/**
 * Compare a generated WAV against the original melody.
 * Returns a quality score based on how well the pitch content matches.
 */
export async function compareAudioQuality(
  generatedWavPath: string,
  melody: ParsedMelody,
): Promise<QualityResult> {
  let refPath: string | null = null;

  try {
    // Generate reference sine-wave melody
    refPath = generateReferenceMelody(melody);

    // Extract chroma frames from both
    const [genFrames, refFrames] = await Promise.all([
      extractChromaFrames(generatedWavPath),
      extractChromaFrames(refPath),
    ]);

    const n = Math.min(genFrames.length, refFrames.length);
    if (n === 0) {
      return { chromaSimilarity: 0, score: 0, label: "Poor", frameCount: 0 };
    }

    // Compute mean cosine similarity between corresponding chroma frames
    let totalSim = 0;
    for (let i = 0; i < n; i++) {
      totalSim += cosineSimilarity(genFrames[i]!, refFrames[i]!);
    }
    const chromaSimilarity = totalSim / n;

    // Map similarity to 0-100 score
    // Cosine similarity 1.0 = perfect, 0.0 = completely different
    // In practice, good chroma matches are 0.7-0.9 range
    const score = Math.round(Math.max(0, Math.min(100, chromaSimilarity * 100)));

    let label: string;
    if (score >= 75) label = "Excellent";
    else if (score >= 55) label = "Good";
    else if (score >= 35) label = "Fair";
    else label = "Poor";

    return { chromaSimilarity: Math.round(chromaSimilarity * 1000) / 1000, score, label, frameCount: n };
  } finally {
    if (refPath) { try { unlinkSync(refPath); } catch { /* ignore */ } }
  }
}
