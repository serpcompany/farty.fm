# MIDI-Based Melody Accuracy Plan (v2)

## Problem

The current melody generation uses hand-typed note arrays with guessed durations. The pitch-shifting method (`asetrate`) changes speed along with pitch, making the output sound distorted and rhythmically wrong. The result barely sounds like the target song.

## Root Causes

| Issue | Why it matters |
|-------|---------------|
| Hand-typed notes/durations | Notes may be wrong, rhythm is approximate, no rests |
| `asetrate` pitch-shifting | Couples pitch + speed: high notes = chipmunk, low notes = slowed down |
| No gaps between notes | Melody is indistinguishable mush |
| No fade in/out | Clicks and pops at segment boundaries |
| Hardcoded base pitch (C4) | If a sample's real pitch is A2, all math is off |

## Completed Steps

### MIDI Files Generated (done)

Instead of downloading random MIDI files with extra harmonies/instruments, we generated our own single-voice MIDI files with musically correct note data.

**Library**: `@tonejs/midi` (installed in backend)
**Script**: `backend/scripts/generate-midis.ts`
**Output**: `test-data/melodies/`

| File | Song | BPM | Time Sig | Notes | Duration |
|------|------|-----|----------|-------|----------|
| `twinkle.mid` | Twinkle Twinkle Little Star | 120 | 4/4 | 14 | 8.0s |
| `happy-birthday.mid` | Happy Birthday | 140 | 3/4 | 25 | 10.3s |
| `mary-lamb.mid` | Mary Had a Little Lamb | 120 | 4/4 | 26 | 16.0s |
| `ode-to-joy.mid` | Ode to Joy | 120 | 4/4 | 30 | 16.0s |
| `jingle-bells.mid` | Jingle Bells (Chorus) | 160 | 4/4 | 51 | 24.0s |

Each file is a single track, single voice — just the melody line with correct note pitches, durations, and gaps derived from BPM.

**Verified**: All files parse correctly with `@tonejs/midi`, returning proper note names, MIDI numbers, start times, durations.

### Multi-Sample Selection (done)

- Frontend supports selecting multiple fart samples (multi-select toggle)
- Backend accepts `samplePaths: string[]` and cycles through them round-robin

## Remaining Steps

### Step 1: Build MIDI Parser Module

Create `backend/src/lib/midi-parser.ts`:
- Reads `.mid` files from `test-data/melodies/`
- Extracts notes with: MIDI pitch, start time (seconds), duration (seconds)
- Detects rests: gaps between one note's end and the next note's start
- Returns a structured array the generator can consume:
  ```ts
  interface ParsedNote {
    midi: number;       // MIDI pitch (e.g. 60 = C4)
    name: string;       // Note name (e.g. "C4")
    time: number;       // Start time in seconds
    duration: number;   // Duration in seconds
    velocity: number;   // 0-1, for optional volume scaling
  }

  interface ParsedMelody {
    key: string;
    name: string;
    bpm: number;
    notes: ParsedNote[];
    totalDuration: number;
  }
  ```

### Step 2: Replace Hardcoded Melody Arrays

- Remove the `MELODIES` constant in `musical-fruit.ts`
- On startup, scan `test-data/melodies/*.mid` and parse each into `ParsedMelody`
- The song list is now driven entirely by which `.mid` files exist
- **Adding a new song = just dropping a new `.mid` file in the folder**

### Step 3: Switch to `rubberband` Pitch-Shifting

Current (bad):
```
ffmpeg -af "asetrate=88200,aresample=44100"  — changes pitch AND speed
```

New (good):
```
ffmpeg -af "rubberband=pitch=1.5"  — changes pitch only, preserves speed
```

- `rubberband` filter confirmed available on this system
- Pitch ratio = `2^(semitoneDiff/12)` (same math, different filter)
- Result: every note sounds like the original fart, just at a different pitch — no chipmunk/slowdown effect

### Step 4: Handle Rests (Silence Between Notes)

MIDI data naturally contains gaps. When `note[i+1].time > note[i].time + note[i].duration`, that gap is a rest.

For each rest:
```
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t {restDuration} rest_N.wav
```

Interleave silence segments in the concat list between pitched note segments.

### Step 5: Add Fades and Volume Normalization

For each note segment:
```
ffmpeg -af "rubberband=pitch={ratio},afade=t=in:d=0.015,afade=t=out:st={dur-0.015}:d=0.015"
```

- **Fade in/out** (15ms): eliminates clicks/pops at segment boundaries
- Optional: **`loudnorm`** or per-note velocity scaling for consistent volume

### Step 6: Update `/melodies` Endpoint

Return richer metadata from parsed MIDI:
```ts
{
  key: "twinkle",
  name: "Twinkle Twinkle Little Star",
  noteCount: 14,
  totalDuration: 8.0,   // accurate from MIDI
  bpm: 120,
}
```

## File Changes

| File | Change |
|------|--------|
| `test-data/melodies/*.mid` | DONE — 5 MIDI files generated |
| `backend/package.json` | DONE — `@tonejs/midi` installed |
| `backend/scripts/generate-midis.ts` | DONE — script that generates the MIDI files |
| `backend/src/lib/midi-parser.ts` | NEW: parse MIDI files into structured note data |
| `backend/src/routes/musical-fruit.ts` | MODIFY: replace hardcoded `MELODIES` with MIDI parser; switch `asetrate` to `rubberband`; add rest handling + fades |

## Implementation Order

1. ~~Generate MIDI files~~ DONE
2. ~~Install `@tonejs/midi`~~ DONE
3. Build MIDI parser module (`midi-parser.ts`)
4. Replace hardcoded melody arrays with parsed MIDI data
5. Switch FFmpeg from `asetrate` to `rubberband`
6. Add rest handling (silence segments)
7. Add fade in/out on each segment
8. Test all 5 melodies for recognizability

## Expected Result

Generated songs should be immediately recognizable as the target melody, with:
- Correct pitch intervals (from MIDI data, not guesswork)
- Correct rhythm and timing (BPM-derived, not hand-typed seconds)
- Natural-sounding rests between phrases
- Clean transitions (no clicks)
- Consistent volume across all notes
- Adding new songs = dropping a `.mid` file in a folder


## MISC

- fart sample selector to a more compact list of rows. with play buttons to preview them, and durations on each
  - should have a 'select all' & 'deselct all'
- picking a song/melody should be a search input type thing that auto filters from options as you type in (not a long ass list)
- generate song should be above the song choices or sticky button
  - should take you over to your library on 'submit' showing the first song being generated there


### Analyze fart samples

When the /samples endpoint is called, we already run ffprobe to get duration. We'd just expand that to also run pitch detection and loudness analysis at the same time. The results get cached in memory so it only happens once per server start.

The flow:

• User uploads/records a fart sample → it lands in test-data/fart-samples/
• First time /samples is hit, we analyze all samples (pitch, loudness, duration) and cache it
• New sample added? Cache invalidates, re-analyzes just the new one
• When /generate is called, the mapping logic uses the cached analysis data to pick which sample plays which note