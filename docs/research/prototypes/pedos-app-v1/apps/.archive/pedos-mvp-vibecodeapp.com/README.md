# Pedos

A fart recording app for iPhone. Record, save, and play back your fart clips.

## Current State: MVP

The core recording loop is fully built:

- **Dashboard** — Stats showing total farts, total duration, longest clip, weekly count, and recent activity
- **Library** — Browse all saved recordings sorted by date
- **Recording** — Tap the floating green mic button to start recording instantly with live timer and waveform animation
- **Review** — Preview your recording, name it, then save or discard
- **Playback** — Play any saved recording with progress bar, waveform, and delete option
- **Haptic feedback** — On record start/stop, save, and delete actions

## Tech Stack

- **Mobile**: Expo SDK 53 + React Native + TypeScript
- **Audio**: expo-av for recording/playback, expo-file-system for persistent storage
- **State**: Zustand with AsyncStorage persistence (local-only, no backend needed)
- **Styling**: NativeWind (Tailwind CSS), light theme with lime-green accents
- **Animations**: react-native-reanimated v3 (waveform, button press, floating button pulse)
- **Icons**: lucide-react-native
- **Backend**: Hono + Bun (available for future features)

## Musical Fruit (MVP)

Turn fart clips into melodies. Working prototype built:

- **Create tab** — Select multiple fart samples + a melody, tap Generate
- **Multi-sample selection** — Pick as many samples as you want; the melody cycles through them round-robin for variety
- **Backend processing** — FFmpeg pitch-shifts each sample to the target note and concatenates into a WAV
- **5 melodies**: Twinkle Twinkle, Happy Birthday, Mary Had a Little Lamb, Ode to Joy, Jingle Bells
- **16 test samples** downloaded from PacDV and SoundBible in `test-data/fart-samples/`
- **Playback** — Listen to the generated fart melody directly in the app

### How it works (current — v1)
1. User selects one or more fart samples and a melody
2. Backend receives the sample paths array, cycles through them round-robin, pitch-shifting each to the target note using `ffmpeg -af asetrate`
3. All pitched segments are concatenated into a single WAV file
4. App streams and plays the result

### Known limitations (v1)
- **Melody data is hand-typed** — notes and durations are hardcoded arrays, not sourced from real sheet music. Rhythm and note accuracy are approximate.
- **`asetrate` pitch-shifting** — couples pitch and speed, so higher notes sound chipmunked and lower notes sound slowed down.
- **No gaps between notes** — segments are hard-concatenated, making the melody hard to distinguish.
- **No fade in/out** — abrupt cuts between segments cause audible clicks/pops.
- **Assumes base pitch = C4** — all samples are treated as C4 regardless of their actual pitch.

### Next: MIDI-based melody accuracy (v2)
See `docs/midi-melody-plan.md` for the full plan.

**Done so far:**
- Generated 5 accurate single-voice MIDI files in `test-data/melodies/` (twinkle, happy-birthday, mary-lamb, ode-to-joy, jingle-bells)
- Installed `@tonejs/midi` parser in backend
- MIDI files verified: correct notes, BPM-derived timing, proper durations

**Remaining:**
1. Build MIDI parser module to replace hardcoded note arrays
2. Switch from `asetrate` to `rubberband` for pitch-shifting without speed change
3. Add silence for rests, fade in/out to eliminate clicks
4. Song list becomes dynamic — add a song by dropping a `.mid` file

### Future improvements
- Upload user recordings to backend so they can be used as source samples
- Client-side real-time preview using `react-native-audio-api` (Web Audio API for RN)
- More melodies, custom melody editor
- Share generated songs

## App Structure

```
mobile/src/
  app/
    _layout.tsx              Root layout with floating record button
    (tabs)/
      _layout.tsx            Dashboard + Library + Create tabs
      index.tsx              Dashboard (stats + recent activity)
      library.tsx            Recording library (FlatList)
      create.tsx             Musical Fruit (sample + melody picker + generation)
    record.tsx               Recording modal (timer + waveform + stop)
    review.tsx               Post-recording review (play + name + save/discard)
    playback.tsx             Full playback with progress bar + delete
  components/
    FloatingRecordButton.tsx Floating green mic button
    WaveformAnimation.tsx    Animated waveform bars
    StatCard.tsx             Stats dashboard card
    RecordingCard.tsx        Recording list item
  lib/
    audio.ts                 Audio recording/playback utilities
    state/
      recordings-store.ts    Zustand store for recordings

backend/src/
  routes/
    musical-fruit.ts         Melody generation endpoints (ffmpeg pitch-shift + concat)
    sample.ts                Example route

test-data/
  fart-samples/              16 fart audio files (WAV + MP3) for testing
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/musical-fruit/samples` | List available test fart samples |
| GET | `/api/musical-fruit/melodies` | List available melodies |
| POST | `/api/musical-fruit/generate` | Generate a fart melody (body: `{samplePaths: string[], melodyName}`) |
| GET | `/api/musical-fruit/output/:filename` | Serve generated audio file |

## Testing

Record farts directly in the app, or use the pre-loaded test samples in the Create tab.
