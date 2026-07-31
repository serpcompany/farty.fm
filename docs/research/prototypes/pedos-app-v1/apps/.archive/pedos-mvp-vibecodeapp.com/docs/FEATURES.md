# Musical Fruit — Features

## Current State (MVP)

Users pick fart sample(s), search for a melody, and hit Generate. The backend analyzes each sample's acoustic properties, intelligently assigns samples to MIDI notes, pitch-shifts them, and concatenates into a playable song. The app navigates to the Library where the song appears with a loading state, then becomes playable once ready.

### End-to-End Flow
1. **Create tab**: Pick samples (with preview + select all) → search/pick melody → Generate
2. **Backend**: Analyze samples (cached) → smart-map to notes → pitch-shift via rubberband → concat with rests + fades
3. **Library tab**: Song appears as "Generating..." → updates to playable with play/pause + delete

---

## Feature: MIDI-Driven Melody Engine

**Status**: Complete

### What It Does
- Reads all `.mid` files from `test-data/melodies/` at startup
- Parses each into structured note data (pitch, timing, duration, velocity)
- Song list is auto-generated — drop a new `.mid` file = new song in the app

### Songs Available (20)
1. Twinkle Twinkle Little Star
2. Happy Birthday
3. Mary Had a Little Lamb
4. Ode to Joy
5. Jingle Bells
6. Row Row Row Your Boat
7. London Bridge
8. Hot Cross Buns
9. Frere Jacques
10. Yankee Doodle
11. When the Saints Go Marching In
12. Amazing Grace
13. Oh! Susanna
14. This Old Man
15. Auld Lang Syne
16. Greensleeves
17. Camptown Races
18. Old MacDonald
19. Fur Elise
20. La Cucaracha

### Audio Quality
- **Rubberband pitch-shifting**: Pitch changes without speed distortion
- **Rubberband time-stretching**: Each sample is compressed or expanded to exactly fill its note duration — no more hard cuts that sound percussive. Ratio clamped to 0.2×–5.0× to avoid extreme artifacts
- **Velocity-based volume**: Each note's volume scales with MIDI velocity (0–1), giving the melody natural dynamics
- **Loudness normalization**: Final output normalized to -16 LUFS (Apple Music / Spotify streaming standard) via FFmpeg `loudnorm` filter — consistent volume regardless of which samples are selected or their original loudness
- **Rest handling**: Silence inserted between notes where the MIDI data has gaps
- **Fade in/out**: 15ms fades on each note to eliminate clicks/pops at segment boundaries

### Bug Fixes
- **`Content-Length` header**: Audio responses now include correct `Content-Length` so the Vibecode proxy forwards the full file — previously the proxy sent 0 bytes, causing silent playback
- **Velocity scaling bug**: `note.velocity` from `@tonejs/midi` is already 0–1; dividing by 127 again made every note near-silent (0.006 gain). Fixed to use velocity directly

### Technical Details
- MIDI parsing via `@tonejs/midi`
- Parser module: `backend/src/lib/midi-parser.ts`
- Generation route: `backend/src/routes/musical-fruit.ts`
- MIDI files: `test-data/melodies/*.mid`
- Generation script: `backend/scripts/generate-midis.ts`
- Pitch-shifting + time-stretching: `rubberband=pitch=X:tempo=Y` FFmpeg filter
- Loudness normalization: `loudnorm=I=-16:TP=-1.5:LRA=11` FFmpeg filter applied as a post-processing pass
- Rest handling: `anullsrc` FFmpeg filter generates silence for MIDI gaps
- Fade: 15ms fade in/out on each segment via `afade` filter
- Frontend sorts melodies alphabetically, shows BPM per song

---

## Feature: Smart Sample-to-Note Mapping

**Status**: Complete

### How It Works
Each fart sample is analyzed once and cached to `test-data/fart-samples/analysis.json`. When generating, the engine scores every available sample against each MIDI note and picks the best match.

### Sample Analysis
- **Brightness** (0-1): Zero-crossing rate measures high vs low frequency content. 0 = deep/bassy, 1 = squeaky/bright
- **Loudness** (dB): Mean volume via FFmpeg `volumedetect`
- **Duration** (seconds): Via FFprobe
- **Pitch** (Hz): Attempted via `pitchfinder` YIN — returns null for most fart sounds (aperiodic noise)

### Mapping Weights
| Factor | Weight | Logic |
|--------|--------|-------|
| Brightness → Pitch | 0.5 | Bright/squeaky samples play high notes, bassy samples play low notes |
| Duration → Note length | 0.3 | Short samples for eighth notes, long samples for whole notes |
| Loudness → Velocity | 0.2 | Louder samples for accented/high-velocity notes |

### Technical Details
- Analyzer: `backend/src/lib/sample-analyzer.ts`
- Uses `pitchfinder` (YIN) for pitch detection, FFmpeg for loudness/duration/brightness
- Cache is per-sample — new samples only trigger analysis for themselves
- One sample selected = that sample for all notes (no mapping needed)
- Mapping normalizes both note properties and sample properties to 0-1 for fair comparison

---

## Feature: Sample Selector with Preview

**Status**: Complete

- Compact iOS-style row list with play/stop buttons to preview each sample
- Duration shown on each row
- Select All / Deselect All toggle
- Backend endpoint `GET /api/musical-fruit/sample-audio/:filename` serves raw sample audio

---

## Feature: Melody Search & Filter

**Status**: Complete

- Search input with clear button filters the 20-melody list in real time
- Melodies sorted alphabetically with note count, duration, and BPM shown

---

## Feature: Sticky Generate Button

**Status**: Complete

- Generate button pinned at top of screen (above scroll content)
- Always visible regardless of scroll position
- Disabled state when no sample or melody selected

---

## Feature: Library with Generated Songs

**Status**: Complete

- On generate, a pending song entry is added to the library (Zustand store, persisted to AsyncStorage)
- App navigates to Library tab immediately showing the song as "Generating..."
- Song status updates to "ready" when backend returns, or "error" on failure
- Library shows generated songs with play/pause and delete, plus recordings in a separate section
- Store: `mobile/src/lib/state/generated-songs-store.ts`

---

## Feature: Recording Flow (Record → Review → Save)

**Status**: Complete

### Flow
1. Floating record button (hidden on record/review/playback screens) opens the record screen
2. **Record screen**: Requests mic permission, auto-starts recording, shows live timer + waveform animation, stop button ends recording and navigates to Review
3. **Review screen**: Shows duration, inline play/pause with waveform, name input (defaults to "Fart #N"), Discard or Save buttons
4. **Save**: Copies temp file to permanent storage (`documentDirectory/recordings/<id>.m4a`), adds to Zustand store (persisted to AsyncStorage), navigates home

### Bug Fixes Applied
- `stopRecording` now calls `getStatusAsync()` before `stopAndUnloadAsync()` — previously crashed because status was read after the recording was already unloaded
- `uuid` replaced with `expo-crypto.randomUUID()` for reliability in React Native
- All `expo-file-system` calls (`getInfoAsync`, `makeDirectoryAsync`, `copyAsync`, `deleteAsync`) guarded with `Platform.OS === 'web'` check — fixes crash on web preview where native file system APIs are unavailable

### Technical Details
- Record screen: `mobile/src/app/record.tsx`
- Review screen: `mobile/src/app/review.tsx`
- Audio utilities: `mobile/src/lib/audio.ts`
- Recordings store: `mobile/src/lib/state/recordings-store.ts`

---

## Feature: Library — Inline Playback for Recordings

**Status**: Complete

- Tapping a recording card in the library now plays it inline (no longer navigates to a separate screen)
- Card shows pause icon and lime highlight while playing; reverts to play icon when done
- Two independent sound refs: one for generated songs, one for recordings — they don't interfere
- `RecordingCard` accepts `isPlaying` prop to reflect state

---

### Audio Quality
- **Crossfade between notes**: Instead of hard cuts, allow slight overlap/fade between adjacent segments for smoother transitions
- **Reverb/effects**: Add a subtle reverb or room effect to glue segments together
- **Spectral centroid** instead of zero-crossing rate for more accurate brightness detection

### Smart Mapping
- **Spectral centroid** instead of zero-crossing rate for more accurate brightness detection
- **Onset detection**: Find the "attack" portion of each sample and align it to note start
- **Harmonic analysis via Essentia.js**: Could extract richer features (MFCC, spectral rolloff) for better matching
- **User-tunable weights**: Let users adjust how much brightness/duration/loudness matter via sliders
- **"Shuffle" mode**: Add randomness to sample selection for less predictable, more fun results

### Content
- **More melodies**: Import from BiMMuDa (Billboard dataset) or POP909 for recognizable pop songs
- **User-uploaded MIDI**: Let users upload their own `.mid` files
- **User-recorded samples**: Wire up local recordings to be uploaded to the server and analyzed
- **Tempo control**: Let users speed up or slow down melodies before generating

### UX
- **Sharing**: Share generated songs via share sheet (AirDrop, Messages, social media)
- **Favorites**: Star/favorite songs in the library
- **Rename songs**: Let users give custom names to generated songs
- **Progress indicator**: Show which note is being generated during long songs
- **Waveform visualization**: Show the actual audio waveform in the library player, not just the animation
