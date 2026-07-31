# Technologies & Libraries Research

## Audio Sample Analysis (Pitch, Loudness, Duration)

### Pitch Detection

- **pitchfinder** — https://www.npmjs.com/package/pitchfinder
  - Pure JS, works in Node/Bun
  - Multiple algorithms (YIN, AMDF, DynamicWavelet, Macleod)
  - YIN is best balance of accuracy/speed
  - Operates on Float32Arrays from WAV files

- **pitchy** — https://www.npmjs.com/package/pitchy
  - Simpler API, returns pitch + "clarity" score
  - ESM-only

- **node-pitchfinder** — https://www.npmjs.com/package/node-pitchfinder
  - Same algorithms as pitchfinder but native C++ addon, faster
  - Node-only (may not work in Bun)

### Loudness Analysis

- **FFmpeg `volumedetect`** — Already installed
  - `ffmpeg -i input.mp3 -af volumedetect -f null /dev/null`
  - Returns mean/max volume in dB

- **FFmpeg `loudnorm`** — LUFS-based loudness normalization
  - Industry standard perceived loudness measurement
  - Dual-pass mode for file-based analysis

- **FFmpeg `ebur128`** — Fast R128 loudness analysis

### Duration

- **FFprobe** — Already in use
  - `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1`

## Sampler Engines (Client-Side / Browser)

- **Tone.js Sampler** — https://tonejs.github.io/docs/15.1.22/classes/Sampler.html
  - Maps samples to pitches, auto-interpolates missing notes
  - Most mature JS sampler engine
  - Velocity only affects gain (no velocity layers yet)

- **smplr** — https://www.npmjs.com/package/smplr
  - Built-in velocity groups, note-to-sample mapping
  - Browser-focused

- **SoundTouchJS** — https://github.com/cutterbl/SoundTouchJS
  - Real-time pitch shifting, tempo adjustment, rate transposition
  - Full TypeScript rewrite, ESM-only
  - AudioWorkletProcessor support

## Full Audio Analysis Frameworks

- **Essentia.js** — https://mtg.github.io/essentia.js/
  - JS/TS library powered by Essentia C++ via WebAssembly
  - BPM, beat positions, pitch, melody, key, chords, MFCC, etc.
  - Works in browser and Node.js

- **Spotify basic-pitch** — https://github.com/spotify/basic-pitch
  - ML-based pitch detection (Python, but has JS port)

## MIDI Libraries

- **@tonejs/midi** — https://www.npmjs.com/package/@tonejs/midi (v2.0.28, installed)
  - Parse and create standard MIDI files
  - Extracts notes, tempo, time signatures, tracks

## Playback / General Audio

- **Howler.js** — https://howlerjs.com/
  - Cross-platform audio playback
  - No sampler/pitch-mapping features

- **expo-av** — In use for mobile playback

## Recommended Approach for Smart Sample Mapping

Use **pitchfinder** + **FFmpeg** on the backend to analyze each fart sample:

1. **pitchfinder (YIN)** — Detect dominant pitch of each sample
2. **FFmpeg volumedetect** — Get loudness (mean dB)
3. **FFprobe** — Get duration (already done)

Then assign samples to MIDI notes intelligently:
- Match sample pitch to nearest MIDI note range (bassy farts on low notes, squeaky farts on high notes)
- Use louder samples for high-velocity MIDI notes
- Use shorter samples for eighth notes, longer samples for whole notes
