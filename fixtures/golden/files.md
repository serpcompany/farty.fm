# The golden files

What each file of the [golden data](README.md) holds, field by field, and the conventions they share.

## Conventions

- **Exact values.** Values that feed a later stage's exact decision are written at full precision (Python's float repr, which round-trips to the same double): `pitch_estimate_midi`, `recording_pitch_midi`, the Song's `start`, `dur` and `length_beats`, and each Arrangement's `plan_cost` and `per_pitch[].shift_semitones`.
- **Rounded values.** Other times in seconds are rounded to 6 decimals, and contour MIDI values to 4 decimals (0.01 cent). Values the engine already rounds (`pitch_confidence`, per-note `shift_semitones`, the `render` values) are kept as the engine rounded them.
- **`null`** means "none": an unvoiced contour frame, or no Recording Pitch for a Noise-like Recording.
- **Decoding.** Audio is decoded as `librosa.load(sr=44100, mono=True)` does it: libsndfile (mpg123 for MP3), resampled to 44.1 kHz with soxr `soxr_hq`, channels averaged to mono. Seven MP3s are 48 kHz stereo, `101` is 48 kHz mono, `100` is 22.05 kHz mono and `103` is 44.1 kHz mono. All sample positions are on that decoded 44.1 kHz timeline and count from the start of the original file.
- **pYIN's pitch grid.** pYIN (resolution 0.1 semitone, fmin 45 Hz) reports pitches on a 10-cent grid offset from equal temperament, at MIDI `x.x259`. Every Recording Pitch sits on that grid. So different Recordings can have exactly the same Recording Pitch (see the tie groups in [Testing a port](port-tests.md#when-an-arrangement-matches)), and an in-tune note reads back 2.6 cents off.

## `recordings/<id>.json`

| Field | Meaning |
| --- | --- |
| `file` | `name`, `sha256`, and the file's own `sample_rate`, `channels` and `frames` as libsndfile reads them. If a port's decoder reports a different frame count, expect its times to be offset (MP3 encoder delay handling). |
| `gesture.start_sample`, `gesture.end_sample` | The single clean gesture (`note_segment()`), in samples at 44.1 kHz. `end_sample` is exclusive. |
| `gesture.start_s`, `gesture.end_s` | The same in seconds, relative to the original file. |
| `gesture.cut_at_reattack` | `true` if the gesture ends at a second attack rather than where the sound fades out. |
| `pitch_contour.midi` | The smoothed pYIN contour of the gesture, in MIDI, one value per hop of 256 samples at 44.1 kHz, `null` when unvoiced. `frames` is its length. See the smoothing steps below. |
| `pitch_estimate_midi` | The Recording Pitch estimate before audition (exact). `null` if there were too few voiced frames or the confidence was below 0.2. |
| `pitch_confidence` | 0 to 1, rounded to 2 decimals by the engine. |
| `recording_pitch_midi` | Recording Pitch (exact): `pitch_estimate_midi` if the Recording passed audition, else `null`. `recording_pitch_note` is the same as a note name with cents. |
| `shortest_note_s` | The shortest note the audition reads back within 40 cents: one of 0.12, 0.2, 0.35, 0.6. `null` for Noise-like Recordings. |
| `settle_s` | When the Recording settles on its pitch (`settle_time()`, #92), in seconds from the gesture start (exact). The whole gesture is played with its pitch held on the Recording Pitch, as the audition does (`variable_resample()`, which only Recording Analysis uses since ADR 0012), and read back by pYIN (frame 2048, hop 256, 45 to 900 Hz). It is the first frame `i` (time `i × 256 / 44100`) that starts 9 voiced frames in a row within ±50 cents of the Recording Pitch, or the gesture length if there is none. `null` for Noise-like Recordings. |
| `melodic` | Melodic (`true`) or Noise-like (`false`). |
| `noise_like_reason` | `no_steady_pitch` (no estimate) or `failed_audition` (an estimate that never read back on pitch), `null` when Melodic. Currently all 8 Noise-like Recordings are `no_steady_pitch`. |
| `rms_db` | RMS level of the gesture in dB. |

The contour is `analyze_recording()`'s `f0`, which a port must reproduce step by step:

1. Run pYIN on the gesture: frame length 2048, hop 256, 45 to 900 Hz, `center=True` (frame `i` is centered on gesture sample `i * 256`, and the signal is zero-padded at both ends). There are `1 + len // 256` frames.
2. A frame is voiced when pYIN marks it voiced, whatever its voiced probability. Until #208 it also needed a voiced probability above 0.05, which dropped most attacks, so the renderer bent each note in from the attack's pitch.
3. If at least 3 frames are voiced, convert to MIDI. Set unvoiced frames to 0, and run a 5-frame median filter over the whole array (`scipy.ndimage.median_filter(size=5)`, default `reflect` edges: `d c b a | a b c d | d c b a`). So an unvoiced neighbor counts as a 0 in the median.
4. Keep the filtered value only on frames that were voiced, and drop any whose filtered value is at most MIDI 10, meaning the median landed on the zeros. Together these remove isolated blips at the edges of voiced runs.
5. If at least 3 frames are left, drop every frame more than 6 semitones from their center (#208): octave errors and glide tails, which the renderer would otherwise bend toward. The center is the energy-weighted median of the frames left: sort them by pitch, weight each by its frame RMS (`librosa.feature.rms`, frame 2048, hop 256, `center=True` with zero padding), and take the first pitch where the cumulative weight reaches half the total.

The Recording Pitch is the energy-weighted median, the same way, of the contour's voiced frames in the first 450 ms, and the confidence is their share of those frames × (1 − spread / 3).

## `songs/<id>.json`

`notes` is the imported melody: `start` and `dur` in beats (exact), `pitch` in MIDI. Also `bpm`, `beats_per_bar`, `length_beats`, the distinct `pitches`, the catalog's `file`, `sha256` and `import_args` (the catalog's `render` options passed to `load_midi`), and `import_report` (track used, chord tones and inner-voice onsets dropped, overlaps clipped, tempo changes ignored, note count; `source_file` is repo-relative).

## `arrangements/<library>/<song>.json`

| Field | Meaning |
| --- | --- |
| `unlocked` | Whether every distinct Song pitch has its own Recording. Locked Songs can't be played, so `render_settings`, `max_abs_shift_semitones`, `notes` and `metrics` are `null`. |
| `missing[]` | The notes no Recording covers, lowest first: `target_midi` (after transposition) and `seconds`, the shortest fart that would cover it: `NOTE_FILL` × the pitch's longest note (`dur × 60 / bpm − 0.025`), rounded up to 0.1 s (`needed_seconds()`, ADR 0011). Empty when the Song is unlocked. The app shows it as "Needs a fart near D♯3 (3.0 s)". |
| `pitch_coverage` | `covered` and `total` distinct Song pitches ("2 of 6 notes covered"). |
| `transpose` | The transposition `melody_fit()` chose, in semitones. |
| `octave_moves` | How many Song pitches use an Octave Move. |
| `plan_cost` | The Arrangement's cost (exact), summed over covered pitches. See [The reference planner](planner.md). |
| `per_pitch[]` | One entry per distinct Song pitch: `song_pitch`, `target_midi`, `recording`, `shift_semitones` (exact: target minus Recording Pitch, which the unlock rule and the cost use; the fart still plays unshifted, ADR 0012) and `octave_move`. When no Recording covers the pitch, `recording`, `shift_semitones` and `octave_move` are `null`, and `target_midi` is the note still needed (also in `missing[]`, with its length). |
| `notes[]` | One entry per Song note, in order: `index`, `song_pitch`, `target_midi` (`song_pitch + transpose`), `recording` (the Recording id that plays it), `shift_semitones` (rounded to 2 decimals by the engine; how far the note is from its fart, not a shift the renderer applies), `heard_cents` (`evaluate.py`'s pYIN read-back distance from the note, `null` if unreadable), `fart_cents` (how far the note sounds from its own fart played dry, by YIN frame by frame; `null` if no frame is loud enough), and `render` (`start_s`, `len_s`, `gain_db` from `render()`, for debugging a renderer port). |
| `max_abs_shift_semitones` | The largest per-note shift. |
| `metrics` | `evaluate.py`'s result on the reference render: `notes`, `within_50c_of_fart_pct` (the bar, ADR 0012), `contour_pct` (the share of the melody's note-to-note steps that move the same way when heard), `pitch_readable_pct`, `within_50c_pct`, `within_50c_any_octave_pct`, `median_abs_cents`, `onsets_on_time_pct`, `notes_with_retrigger`, `distinct_recordings`, `on_pitch_pct` (#208), `sounding_pct` (the mean share of each note's time that sounds: 10 ms frames within 30 dB of the note's peak, #205) and `notes_mostly_silent` (notes under half sounding). |
| `render_settings` | The Song's `bpm`. Every fart plays raw, at its own pitch and speed (ADR 0012), so there is no `tune` any more. |

## `coverage.json`

`subsets[]`: each has `recordings` (the subset's ids) and `songs[]`, one per catalog Song: `song`, `unlocked`, `pitch_coverage`, `transpose`, `octave_moves`, `plan_cost`, `recording_for_pitch` (Song pitch as a string, to a Recording id or `null`) and `missing` (as in the arrangements). It's what a port's Pitch Coverage test compares with on every subset. Arrangements aren't rendered here.
