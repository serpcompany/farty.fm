import { Midi } from "@tonejs/midi";
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedNote {
  midi: number;       // MIDI pitch (e.g. 60 = C4)
  name: string;       // Note name (e.g. "C4")
  time: number;       // Start time in seconds
  duration: number;   // Duration in seconds
  velocity: number;   // 0-1 for volume scaling
}

export interface ParsedMelody {
  key: string;        // filename without .mid extension (e.g. "twinkle")
  name: string;       // Human-readable name derived from key (e.g. "Twinkle")
  bpm: number;
  notes: ParsedNote[];
  totalDuration: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MELODIES_DIR = "/home/user/workspace/test-data/melodies";

/**
 * Convert a kebab-case key like "happy-birthday" to "Happy Birthday".
 */
function keyToName(key: string): string {
  return key
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Parse a single .mid file into a ParsedMelody.
 */
function parseMidiFile(filePath: string): ParsedMelody {
  const buffer = readFileSync(filePath);
  const midi = new Midi(buffer);

  const key = basename(filePath, ".mid");
  const name = keyToName(key);

  // Extract BPM from first tempo event, default to 120
  const bpm = midi.header.tempos.length > 0
    ? midi.header.tempos[0]!.bpm
    : 120;

  // Find the first track that has notes
  let sourceNotes: ParsedNote[] = [];
  for (const track of midi.tracks) {
    if (track.notes.length > 0) {
      sourceNotes = track.notes.map((note) => ({
        midi: note.midi,
        name: note.name,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity,
      }));
      break;
    }
  }

  const totalDuration = sourceNotes.length > 0
    ? Math.max(...sourceNotes.map((n) => n.time + n.duration))
    : 0;

  return { key, name, bpm, notes: sourceNotes, totalDuration };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const melodyCache = new Map<string, ParsedMelody>();
let allLoaded = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all .mid files from the melodies directory.
 * Results are cached after the first call.
 */
export function loadAllMelodies(): ParsedMelody[] {
  if (allLoaded) {
    return Array.from(melodyCache.values());
  }

  const files = readdirSync(MELODIES_DIR).filter((f) => f.endsWith(".mid"));

  for (const file of files) {
    const filePath = join(MELODIES_DIR, file);
    const melody = parseMidiFile(filePath);
    melodyCache.set(melody.key, melody);
  }

  allLoaded = true;
  return Array.from(melodyCache.values());
}

/**
 * Load a single melody by key (filename without .mid extension).
 * Returns undefined if not found.
 */
export function loadMelody(key: string): ParsedMelody | undefined {
  // Check cache first
  if (melodyCache.has(key)) {
    return melodyCache.get(key);
  }

  // Try loading the specific file
  const filePath = join(MELODIES_DIR, `${key}.mid`);
  try {
    const melody = parseMidiFile(filePath);
    melodyCache.set(key, melody);
    return melody;
  } catch {
    return undefined;
  }
}
