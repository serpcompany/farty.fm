import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { loadAllMelodies, loadMelody } from "../lib/midi-parser.ts";
import type { ParsedNote } from "../lib/midi-parser.ts";
import { getAnalysesForPaths } from "../lib/sample-analyzer.ts";
import type { SampleAnalysis } from "../lib/sample-analyzer.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLES_DIR = "/home/user/workspace/test-data/fart-samples";
const OUTPUT_DIR = "/tmp/musical-fruit-output";

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Note / MIDI helpers
// ---------------------------------------------------------------------------

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, "C#": 1, Db: 1,
  D: 2, "D#": 3, Eb: 3,
  E: 4,
  F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8,
  A: 9, "A#": 10, Bb: 10,
  B: 11,
};

function noteToMidi(note: string): number {
  const match = note.match(/^([A-G]#?b?)(\d+)$/);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const name = match[1]!;
  const octaveStr = match[2]!;
  const octave = parseInt(octaveStr, 10);
  const semitone = NOTE_TO_SEMITONE[name];
  if (semitone === undefined) throw new Error(`Invalid note name: ${name}`);
  return (octave + 1) * 12 + semitone;
}

// Base note: C4 = MIDI 60
const BASE_MIDI = 60;

// ---------------------------------------------------------------------------
// Smart sample-to-note mapping
// ---------------------------------------------------------------------------

/**
 * Pick the best sample for each note based on:
 * - Brightness → MIDI pitch (bright/squeaky samples for high notes, bassy for low)
 * - Duration → note duration (short samples for short notes, long for long)
 * - Loudness → velocity (loud samples for high-velocity notes)
 *
 * Each factor is scored 0-1 and weighted. The sample with the lowest total
 * distance from the "ideal" for that note wins.
 */
function pickSampleForNote(
  note: ParsedNote,
  analyses: SampleAnalysis[],
  melodyMidiRange: { min: number; max: number },
  melodyDurationRange: { min: number; max: number },
  melodyVelocityRange: { min: number; max: number },
): SampleAnalysis {
  // Normalize the note's properties to 0-1
  const midiSpan = melodyMidiRange.max - melodyMidiRange.min || 1;
  const notePitchNorm = (note.midi - melodyMidiRange.min) / midiSpan;

  const durSpan = melodyDurationRange.max - melodyDurationRange.min || 1;
  const noteDurNorm = (note.duration - melodyDurationRange.min) / durSpan;

  const velSpan = melodyVelocityRange.max - melodyVelocityRange.min || 1;
  const noteVelNorm = (note.velocity - melodyVelocityRange.min) / velSpan;

  // Normalize sample properties
  const durs = analyses.map((a) => a.duration);
  const minDur = Math.min(...durs);
  const maxDur = Math.max(...durs);
  const durRange = maxDur - minDur || 1;

  const louds = analyses.map((a) => a.loudness);
  const minLoud = Math.min(...louds);
  const maxLoud = Math.max(...louds);
  const loudRange = maxLoud - minLoud || 1;

  // Weights: brightness matters most (pitch character), then duration, then loudness
  const W_BRIGHT = 0.5;
  const W_DUR = 0.3;
  const W_LOUD = 0.2;

  let bestSample = analyses[0]!;
  let bestScore = Infinity;

  for (const sample of analyses) {
    const brightDist = Math.abs(sample.brightness - notePitchNorm);
    const durNorm = (sample.duration - minDur) / durRange;
    const durDist = Math.abs(durNorm - noteDurNorm);
    const loudNorm = (sample.loudness - minLoud) / loudRange;
    const loudDist = Math.abs(loudNorm - noteVelNorm);

    const score = W_BRIGHT * brightDist + W_DUR * durDist + W_LOUD * loudDist;

    if (score < bestScore) {
      bestScore = score;
      bestSample = sample;
    }
  }

  return bestSample;
}

type SampleAssignment = { path: string; sampleDuration: number };

function buildSampleMap(
  notes: ParsedNote[],
  analyses: SampleAnalysis[],
): SampleAssignment[] {
  if (analyses.length === 1) {
    // Only one sample, use it for everything
    return notes.map(() => ({ path: analyses[0]!.path, sampleDuration: analyses[0]!.duration }));
  }

  // Compute melody ranges for normalization
  const midiValues = notes.map((n) => n.midi);
  const melodyMidiRange = { min: Math.min(...midiValues), max: Math.max(...midiValues) };

  const durValues = notes.map((n) => n.duration);
  const melodyDurationRange = { min: Math.min(...durValues), max: Math.max(...durValues) };

  const velValues = notes.map((n) => n.velocity);
  const melodyVelocityRange = { min: Math.min(...velValues), max: Math.max(...velValues) };

  return notes.map((note) => {
    const analysis = pickSampleForNote(note, analyses, melodyMidiRange, melodyDurationRange, melodyVelocityRange);
    return { path: analysis.path, sampleDuration: analysis.duration };
  });
}

// ---------------------------------------------------------------------------
// Audio generation via ffmpeg
// ---------------------------------------------------------------------------

function getSampleRate(filePath: string): number {
  const out = execSync(
    `ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    { encoding: "utf-8" },
  );
  return parseInt(out.trim(), 10) || 44100;
}

function generateMelody(sampleAssignments: SampleAssignment[], notes: ParsedNote[], melodyKey: string): string {
  const jobId = randomUUID();
  const jobDir = join(OUTPUT_DIR, jobId);
  mkdirSync(jobDir, { recursive: true });

  // Use the sample rate from the first sample
  const sampleRate = getSampleRate(sampleAssignments[0]!.path);
  const segmentFiles: string[] = [];

  try {
    let segIndex = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]!;
      const assignment = sampleAssignments[i]!;

      const semitoneDiff = note.midi - BASE_MIDI;
      const pitchRatio = Math.pow(2, semitoneDiff / 12);
      const duration = note.duration;

      // Time-stretch: compress or expand sample to fill the note duration exactly
      const tempoRatio = Math.min(Math.max(assignment.sampleDuration / duration, 0.2), 5.0);

      // Velocity-based volume scaling (note.velocity is already 0-1)
      const volumeGain = note.velocity.toFixed(4);

      const segFile = join(jobDir, `seg_${String(segIndex).padStart(4, "0")}.wav`);
      segmentFiles.push(segFile);

      // Pitch-shift + time-stretch using rubberband, velocity volume, fade in/out to avoid clicks
      execSync(
        `ffmpeg -y -i "${assignment.path}" -af "rubberband=pitch=${pitchRatio}:tempo=${tempoRatio},volume=${volumeGain},afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, duration - 0.015)}:d=0.015" -t ${duration} -ar ${sampleRate} -ac 1 -sample_fmt s16 "${segFile}" 2>/dev/null`,
      );
      segIndex++;

      // Check for rest (gap) between this note and the next
      const nextNote = notes[i + 1];
      if (nextNote) {
        const noteEnd = note.time + note.duration;
        const restDuration = nextNote.time - noteEnd;
        if (restDuration > 0.001) {
          const restFile = join(jobDir, `seg_${String(segIndex).padStart(4, "0")}.wav`);
          segmentFiles.push(restFile);

          // Generate silence for the rest
          execSync(
            `ffmpeg -f lavfi -i anullsrc=r=${sampleRate}:cl=mono -t ${restDuration} -sample_fmt s16 "${restFile}" 2>/dev/null`,
          );
          segIndex++;
        }
      }
    }

    // Build a concat file list for ffmpeg
    const concatListPath = join(jobDir, "concat.txt");
    const concatContent = segmentFiles.map((f) => `file '${f}'`).join("\n");
    writeFileSync(concatListPath, concatContent, "utf-8");

    // Concatenate all segments into a raw mix
    const rawPath = join(jobDir, "raw_mix.wav");

    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${rawPath}" 2>/dev/null`,
    );

    // Normalize loudness to -16 LUFS (Apple Music / Spotify streaming standard)
    // This ensures consistent volume regardless of sample levels or velocity values
    const outputFilename = `${melodyKey}_${jobId.slice(0, 8)}.wav`;
    const outputPath = join(OUTPUT_DIR, outputFilename);

    execSync(
      `ffmpeg -y -i "${rawPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar ${sampleRate} -ac 1 -sample_fmt s16 "${outputPath}" 2>/dev/null`,
    );

    // Clean up temp segment directory
    for (const f of segmentFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
    try { unlinkSync(concatListPath); } catch { /* ignore */ }
    try { execSync(`rm -rf "${jobDir}"`); } catch { /* ignore */ }

    return outputFilename;
  } catch (err) {
    // Clean up on error
    try { execSync(`rm -rf "${jobDir}"`); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const musicalFruitRouter = new Hono();

// GET /samples - list available fart samples
musicalFruitRouter.get("/samples", (c) => {
  const files = readdirSync(SAMPLES_DIR).filter((f) =>
    /\.(wav|mp3|ogg|m4a)$/i.test(f),
  );
  const samples = files.map((filename) => {
    const filePath = join(SAMPLES_DIR, filename);
    let duration = 0;
    try {
      const out = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: "utf-8" },
      );
      duration = parseFloat(out.trim()) || 0;
    } catch {
      // If ffprobe fails, duration stays 0
    }
    return { filename, path: filePath, duration };
  });
  return c.json({ data: samples });
});

// GET /sample-audio/:filename - serve a sample audio file for preview
musicalFruitRouter.get("/sample-audio/:filename", (c) => {
  const { filename } = c.req.param();

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: { message: "Invalid filename", code: "INVALID_FILENAME" } }, 400);
  }

  const filePath = join(SAMPLES_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: { message: "File not found", code: "NOT_FOUND" } }, 404);
  }

  const fileData = readFileSync(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : ext === "m4a" ? "audio/mp4" : "audio/wav";

  return new Response(fileData, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": fileData.length.toString(),
    },
  });
});

// GET /melodies - list available melodies
musicalFruitRouter.get("/melodies", (c) => {
  const melodies = loadAllMelodies().map((melody) => ({
    key: melody.key,
    name: melody.name,
    noteCount: melody.notes.length,
    totalDuration: melody.totalDuration,
    bpm: melody.bpm,
  }));
  return c.json({ data: melodies });
});

// POST /generate - generate a melody from a fart sample
const generateSchema = z.object({
  samplePaths: z.array(z.string().min(1)).min(1),
  melodyName: z.string().min(1),
});

musicalFruitRouter.post(
  "/generate",
  zValidator("json", generateSchema),
  (c) => {
    const { samplePaths, melodyName } = c.req.valid("json");

    // Validate melody exists
    const melody = loadMelody(melodyName);
    if (!melody) {
      const available = loadAllMelodies().map((m) => m.key);
      return c.json(
        {
          error: {
            message: `Unknown melody: ${melodyName}. Available: ${available.join(", ")}`,
            code: "INVALID_MELODY",
          },
        },
        400,
      );
    }

    // Validate all sample files exist
    for (const sp of samplePaths) {
      if (!existsSync(sp)) {
        return c.json(
          {
            error: {
              message: `Sample file not found: ${sp}`,
              code: "SAMPLE_NOT_FOUND",
            },
          },
          400,
        );
      }
    }

    try {
      // Analyze selected samples and build smart mapping
      const analyses = getAnalysesForPaths(samplePaths);
      const sampleAssignments = buildSampleMap(melody.notes, analyses);
      const outputFilename = generateMelody(sampleAssignments, melody.notes, melodyName);
      const outputFilePath = join(OUTPUT_DIR, outputFilename);
      let durationSeconds = 0;
      try {
        const ffprobeOut = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputFilePath}"`,
          { encoding: "utf-8" },
        );
        durationSeconds = parseFloat(ffprobeOut.trim()) || 0;
      } catch {
        // If ffprobe fails, durationSeconds stays 0
      }
      return c.json({
        data: {
          filename: outputFilename,
          url: `/api/musical-fruit/output/${outputFilename}`,
          melody: melodyName,
          melodyName: melody.name,
          durationSeconds,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during audio generation";
      return c.json(
        { error: { message, code: "GENERATION_FAILED" } },
        500,
      );
    }
  },
);

// GET /output/:filename - serve generated audio files
musicalFruitRouter.get("/output/:filename", (c) => {
  const { filename } = c.req.param();

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: { message: "Invalid filename", code: "INVALID_FILENAME" } }, 400);
  }

  const filePath = join(OUTPUT_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: { message: "File not found", code: "NOT_FOUND" } }, 404);
  }

  const fileData = readFileSync(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = ext === "mp3" ? "audio/mpeg" : "audio/wav";

  return new Response(fileData, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": fileData.length.toString(),
    },
  });
});

// GET /output-info/:filename - get metadata for a generated output file
musicalFruitRouter.get("/output-info/:filename", (c) => {
  const { filename } = c.req.param();

  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: { message: "Invalid filename", code: "INVALID_FILENAME" } }, 400);
  }

  const filePath = join(OUTPUT_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: { message: "File not found", code: "NOT_FOUND" } }, 404);
  }

  let durationSeconds = 0;
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: "utf-8" },
    );
    durationSeconds = parseFloat(out.trim()) || 0;
  } catch {
    // ignore
  }

  return c.json({ data: { durationSeconds } });
});

// POST /analyze-recording - analyze an uploaded audio file and return audio properties
musicalFruitRouter.post("/analyze-recording", async (c) => {
  let tmpPath: string | null = null;

  try {
    const formData = await c.req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return c.json({ error: { message: "No audio file", code: "NO_FILE" } }, 400);
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    tmpPath = `/tmp/recording-analysis-${randomUUID()}.tmp`;
    writeFileSync(tmpPath, Buffer.from(arrayBuffer));

    // Duration via ffprobe
    let duration = 0;
    try {
      const durationOut = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpPath}"`,
        { encoding: "utf-8" },
      );
      duration = parseFloat(durationOut.trim()) || 0;
    } catch {
      duration = 0;
    }

    // Loudness via ffmpeg volumedetect (mean_volume)
    let loudness = -20;
    try {
      const loudnessOut = execSync(
        `ffmpeg -i "${tmpPath}" -af volumedetect -f null /dev/null 2>&1`,
        { encoding: "utf-8" },
      );
      const match = loudnessOut.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (match && match[1]) {
        loudness = parseFloat(match[1]);
      }
    } catch {
      loudness = -20;
    }

    // Brightness via zero-crossing rate on raw s16le PCM
    let brightness = 0.5;
    try {
      const SAMPLE_RATE = 44100;
      const buffer = execSync(
        `ffmpeg -i "${tmpPath}" -t 2 -f f32le -acodec pcm_f32le -ar ${SAMPLE_RATE} -ac 1 pipe:1 2>/dev/null`,
        { maxBuffer: SAMPLE_RATE * 4 * 2 + 1024 },
      );

      const floatArray = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 4,
      );

      let zeroCrossings = 0;
      for (let i = 1; i < floatArray.length; i++) {
        if (
          (floatArray[i]! >= 0 && floatArray[i - 1]! < 0) ||
          (floatArray[i]! < 0 && floatArray[i - 1]! >= 0)
        ) {
          zeroCrossings++;
        }
      }

      const rate = zeroCrossings / floatArray.length;
      brightness = Math.max(0, Math.min(1, (rate - 0.01) / 0.14));
      brightness = Math.round(brightness * 100) / 100;
    } catch {
      brightness = 0.5;
    }

    return c.json({ data: { brightness, loudness, duration } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return c.json({ error: { message, code: "ANALYSIS_FAILED" } }, 500);
  } finally {
    if (tmpPath) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
});

export { musicalFruitRouter };
