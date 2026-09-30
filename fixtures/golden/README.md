# Golden data from the reference engine

The answers of the approved Python reference engine ([`tools/melody-lab/`](../../tools/melody-lab/)) for the Fixture Library and the Song Catalog. Swift port tests check themselves against these files. Everything except this README is generated; don't edit it by hand.

Regenerate after any change to the lab, the Fixture Library or the catalog, and commit the result:

```sh
cd tools/melody-lab && .venv/bin/python export_golden.py
```

The script deletes and rewrites `index.json`, `recordings/`, `songs/` and `arrangements/`. It uses the same calls as `run_all.py` (`load_library`, `load_catalog`, `plan`, `render(tune=1.0)`, `evaluate`) and prints the same summary line per Song and library. Running it twice gives byte-identical files (keys sorted, floats rounded). Other library versions may change low-order digits, which is why the tests below use tolerances. `index.json` records the versions used.

Rendered audio is not exported (too large). Swift renders are judged by running the same checks on their own output.

## Layout

| Path | Contents |
| --- | --- |
| `index.json` | Libraries, Recording and Song ids, the Melodic Recordings, each Song's transposition per library, and the library versions used |
| `recordings/<id>.json` | Recording Analysis of each of the 23 Fixture Library Recordings |
| `songs/<id>.json` | The imported melody of each catalog Song (`melody.py`) |
| `arrangements/full/<song>.json` | Transposition, Arrangement and `evaluate.py` metrics using the whole Fixture Library (23 Recordings) |
| `arrangements/small/<song>.json` | The same using only `002 009 016 021 069 090` (`build.py`'s `SMALL_LIBRARY`, a plausible new user's first six; only 021 and 090 are Melodic) |

Songs: all 13 catalog entries, the ones `run_all.py` renders. This includes `ode-mutopia`, an SATB score of Ode to Joy that exercises the skyline importer. `build.py` and the design prototype skip it, so the app lists 12 Songs.

## Conventions

- Times in seconds are rounded to 6 decimals, beats to 6 decimals (a triplet of 4/3 beat is `1.333333`), and MIDI values to 4 decimals (0.01 cent). Values the engine already rounds (`pitch_confidence`, `shift_semitones`, the `render` values) are kept as the engine rounded them.
- `null` means "none": an unvoiced contour frame, or no Recording Pitch for a Noise-like Recording.
- Audio is decoded as `librosa.load(sr=44100, mono=True)` does it: libsndfile (mpg123 for MP3), resampled to 44.1 kHz with soxr `soxr_hq`, channels averaged to mono. Five MP3s are 48 kHz stereo. All sample positions are on that decoded 44.1 kHz timeline and count from the start of the original file.

## `recordings/<id>.json`

| Field | Meaning |
| --- | --- |
| `file` | `name`, `sha256`, and the file's own `sample_rate`, `channels` and `frames` as libsndfile reads them. If Swift's decoder reports a different frame count, expect its times to be offset (MP3 encoder delay handling). |
| `gesture.start_sample`, `gesture.end_sample` | The single clean gesture (`note_segment()`), in samples at 44.1 kHz. `end_sample` is exclusive. |
| `gesture.start_s`, `gesture.end_s` | The same in seconds, relative to the original file. |
| `gesture.cut_at_reattack` | `true` if the gesture ends at a second attack rather than where the sound fades out. |
| `pitch_contour.midi` | The smoothed pYIN contour of the gesture, in MIDI, one value per hop of 256 samples at 44.1 kHz, `null` when unvoiced. Frame `i` is centered on gesture sample `i * 256` (`center=True`, frame length 2048, 45 to 900 Hz, voiced probability above 0.05, 5-frame median). `frames` is its length. |
| `pitch_estimate_midi` | The Recording Pitch estimate before audition, or `null` if there were too few voiced frames or the confidence was below 0.1. |
| `pitch_confidence` | 0 to 1, rounded to 2 decimals by the engine. |
| `recording_pitch_midi` | Recording Pitch: `pitch_estimate_midi` if the Recording passed audition, else `null`. `recording_pitch_note` is the same as a note name with cents. |
| `shortest_note_s` | The shortest note the audition reads back within 40 cents: one of 0.12, 0.2, 0.35, 0.6. `null` for Noise-like Recordings. |
| `melodic` | Melodic (`true`) or Noise-like (`false`). |
| `noise_like_reason` | `no_steady_pitch` (no estimate) or `failed_audition` (an estimate that never read back on pitch), `null` when Melodic. Currently all 14 Noise-like Recordings are `no_steady_pitch`. |
| `rms_db` | RMS level of the gesture in dB. |

## `songs/<id>.json`

`notes` is the imported melody: `start` and `dur` in beats, `pitch` in MIDI. Also `bpm`, `beats_per_bar`, `length_beats`, the distinct `pitches`, the catalog's `file`, `sha256` and `import_args` (the catalog's `render` options passed to `load_midi`), and `import_report` (track used, chord tones and inner-voice onsets dropped, overlaps clipped, tempo changes ignored, note count; `source_file` is repo-relative).

## `arrangements/<library>/<song>.json`

| Field | Meaning |
| --- | --- |
| `transpose` | The transposition `plan()` chose, in semitones. |
| `notes[]` | One entry per Song note, in order: `index`, `song_pitch`, `target_midi` (`song_pitch + transpose`), `recording` (the Recording id that plays it), `shift_semitones` (target minus Recording Pitch, rounded to 2 decimals by the engine), `heard_cents` (`evaluate.py`'s read-back error for that note, `null` if unreadable), and `render` (`start_s`, `len_s`, `gain_db` from `render()`, for debugging a renderer port). |
| `max_abs_shift_semitones` | The largest shift in the Arrangement. |
| `metrics` | `evaluate.py`'s result on the reference render: `notes`, `pitch_readable_pct`, `within_50c_pct`, `within_50c_any_octave_pct`, `median_abs_cents`, `onsets_on_time_pct`, `notes_with_retrigger`, `distinct_recordings`. |
| `render_settings` | `tune` 1.0 (the rate follows the Recording's pitch contour), the Song's `bpm`, and `variety` false. |

## Tolerances for Swift tests

| Check | Tolerance |
| --- | --- |
| Gesture bounds (`gesture.start_s`, `gesture.end_s`) | ±10 ms, and the same `cut_at_reattack` |
| Recording Pitch (`recording_pitch_midi`) | ±30 cents (±0.30 in MIDI) |
| Melodic or Noise-like (`melodic`) | The same split for all 23 Recordings (9 Melodic: `013 017 019 021 059 084 086 090 094`) |
| Transposition and Arrangement (`transpose`, each note's `recording` and `target_midi`) | Identical |
| Imported notes | Same count and pitches; `start` and `dur` within 1e-6 beats; same `bpm` and `beats_per_bar` |

Notes for these checks:

- **Test the planner on the golden inputs.** Feed it the golden `recording_pitch_midi` and `shortest_note_s` and the golden Song notes, not the Swift analysis output. Otherwise a pitch that is within tolerance can still change a close planning decision. Then `shift_semitones` should also match within 0.005.
- **Three Recordings sit near the Melodic threshold** (confidence 0.1): `002` and `022` at 0.09 (Noise-like), and `017` at 0.13 (Melodic). They are the most likely to flip if a Swift pitch tracker differs slightly.
- **Pitch contour and `shortest_note_s`** have no tolerance of their own. They are there to diagnose a failing Recording Pitch or Melodic test. `shortest_note_s` also feeds the planner, so planner tests use the golden value.
- **Metrics are a baseline, not an exact target.** A Swift render is judged by running the same checks on its own output against ADR 0004's thresholds (notes within ±50 cents, onsets within ±50 ms, no second attack inside a note). It should do no worse than the golden values; matching them digit for digit isn't expected.

## The planner will change (#43)

[ADR 0004](../../docs/adr/0004-fart-only-rendering.md) now says Auto-map gives each distinct pitch its own Melodic Recording, shifted by at most 3 semitones. The reference `plan()` doesn't do that yet: it reuses Recordings and allows shifts up to 12 semitones (for example `merryxmas` on the full library shifts by up to 9.4, and every `small` Arrangement uses only 2 Recordings). #43 changes `plan()` and re-exports these files. Until then, `arrangements/` reflects the current planner, and Swift planner tests written against it must be updated with that re-export. `recordings/` and `songs/` don't depend on the planner.
