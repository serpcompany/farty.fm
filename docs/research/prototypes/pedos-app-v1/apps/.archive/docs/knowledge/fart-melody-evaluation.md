# Fart Melody Evaluation Findings

Last reviewed: `2026-03-19`

## What was tested

The local `Fart Melody Maker` renderer was scored against target cover melodies by:

1. rendering fart-only melody WAVs
2. extracting segment pitch with `librosa.pyin`
3. comparing rendered segment pitches against the target note sequence
4. checking contour similarity after a best-fit global transposition

Saved artifacts:

- `tmp/fart-melody-maker/eval-results.json`
- `tmp/fart-melody-maker/eval-summary.json`

## Current measured results

### `star-spangled-banner-mvp`

- voiced segment ratio: `1.0`
- contour match rate: `0.417`
- mean absolute note error after best global transpose: `7.25` semitones
- within `1` semitone after transpose: `0.231`

### `star-spangled-banner-5clips`

- voiced segment ratio: `1.0`
- contour match rate: `0.5`
- mean absolute note error after best global transpose: `5.38` semitones
- within `1` semitone after transpose: `0.231`

### `happy-birthday-5clips`

- voiced segment ratio: `0.833`
- contour match rate: `0.889`
- mean absolute note error after best global transpose: `3.49` semitones
- within `1` semitone after transpose: `0.8`

### `twinkle-twinkle-5clips`

- voiced segment ratio: `0.857`
- contour match rate: `0.818`
- mean absolute note error after best global transpose: `6.7` semitones
- within `1` semitone after transpose: `0.25`

## Takeaway

The current renderer is deterministic, but it is still not good enough for reliable recognizable covers.

The strongest result so far is `happy-birthday-5clips`, not `The Star-Spangled Banner`.

The main failure modes are:

- clip pitch anchors are too crude
- some clips are weak or unstable note sources
- the renderer is forcing note targets without a real melody-fit gate
- harder melodies need more tonal clips and better pitch analysis before render

## Better toolchain for the next pass

Use MIR tooling, not generative music APIs:

- `librosa`
  - `pyin` for frame or segment pitch extraction
  - `sequence.dtw` for timing alignment
- `mir_eval`
  - melody and note-level evaluation metrics
- `Basic Pitch`
  - audio-to-MIDI / note extraction
- `Sonic Visualiser` and `sonic-annotator`
  - visual debugging of spectrograms, note tracks, and onset placement

## Practical next step

Build a `melody-eval` tool that takes:

- target melody template
- rendered fart melody WAV

and outputs:

- note accuracy summary
- contour score
- timing score
- clip-fit warnings
- debug artifacts for manual review
