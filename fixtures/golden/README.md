# Golden data from the reference engine

The answers of the approved Python reference engine ([`tools/melody-lab/`](../../tools/melody-lab/)) for the Fixture Library and the Song Catalog. The web app's port (`apps/web/src/lib/analysis/` and `src/lib/engine/`) checks itself against these files. Swift doesn't: it is frozen at format 2, before the settle cost (#116), the pitch contour that keeps the attack (#208) and the silence cost (#205), and its tests read their own copy of that format in [`RecordingAnalysisKit/Tests/GoldenFormat2/`](../../RecordingAnalysisKit/Tests/GoldenFormat2/). Everything except this README is generated; don't edit it by hand.

Regenerate after any change to the lab, the Fixture Library or the catalog, and commit the result:

```sh
cd tools/melody-lab && .venv/bin/python export_golden.py
```

The script deletes and rewrites `index.json`, `recordings/`, `songs/`, `arrangements/` and `coverage.json`. It uses the same calls as `run_all.py` (`load_library`, `load_catalog`, `melody_fit`, `plan`, `render(tune=1.0)`, `evaluate`) and prints the same summary line per Song and library. Running it twice gives byte-identical files (keys sorted, floats rounded or written exactly). Other library versions may change low-order digits, which is why the tests below use tolerances. `requirements.txt` pins them, including soxr, which decides the decoded samples of the 48 kHz MP3s. `index.json` records the versions used.

Rendered audio is not exported (too large). Swift renders are judged by running the same checks on their own output.

## Layout

| Path | Contents |
| --- | --- |
| `index.json` | Libraries, Recording and Song ids, the Melodic Recordings, the tie groups, each Song's transposition and unlock state per library, and the library versions used |
| `recordings/<id>.json` | Recording Analysis of each of the 32 Fixture Library Recordings |
| `songs/<id>.json` | The imported melody of each catalog Song (`melody.py`) |
| `arrangements/full/<song>.json` | Pitch Coverage, transposition, Arrangement and `evaluate.py` metrics using the whole Fixture Library (32 Recordings). Every Song is unlocked. |
| `arrangements/small/<song>.json` | The same using only `002 009 016 022 069 090` (`build.py`'s `SMALL_LIBRARY`, a plausible new user's first six). All but `009` are Melodic, and `016` and `022` are a tie group. `mary`, `jingle`, `saints`, `ode` and `ode-mutopia` unlock and read at or above ADR 0004's 94% bar (see "Metrics" below); the other 8 Songs are locked at 5 notes covered, with Pitch Coverage and the partial Arrangement but nothing to render. |
| `coverage.json` | Pitch Coverage and Arrangement of every Song on 50 fixed random subsets of the Fixture Library: 10 each of 3, 6 and 9 Recordings, and of 4 and 6 Melodic Recordings |

Songs: all 13 catalog entries, the ones `run_all.py` renders. This includes `ode-mutopia`, an SATB score of Ode to Joy that exercises the skyline importer. `build.py` and the design prototype skip it, so the app lists 12 Songs.

## Conventions

- **Exact values.** Values that feed a later stage's exact decision are written at full precision (Python's float repr, which round-trips to the same double): `pitch_estimate_midi`, `recording_pitch_midi`, the Song's `start`, `dur` and `length_beats`, and each Arrangement's `plan_cost` and `per_pitch[].shift_semitones`.
- **Rounded values.** Other times in seconds are rounded to 6 decimals, and contour MIDI values to 4 decimals (0.01 cent). Values the engine already rounds (`pitch_confidence`, per-note `shift_semitones`, the `render` values) are kept as the engine rounded them.
- **`null`** means "none": an unvoiced contour frame, or no Recording Pitch for a Noise-like Recording.
- **Decoding.** Audio is decoded as `librosa.load(sr=44100, mono=True)` does it: libsndfile (mpg123 for MP3), resampled to 44.1 kHz with soxr `soxr_hq`, channels averaged to mono. Seven MP3s are 48 kHz stereo, `101` is 48 kHz mono and `100` is 22.05 kHz mono. All sample positions are on that decoded 44.1 kHz timeline and count from the start of the original file.
- **pYIN's pitch grid.** pYIN (resolution 0.1 semitone, fmin 45 Hz) reports pitches on a 10-cent grid offset from equal temperament, at MIDI `x.x259`. Every Recording Pitch sits on that grid. So different Recordings can have exactly the same Recording Pitch (see tie groups below), and an in-tune note reads back 2.6 cents off.

## `recordings/<id>.json`

| Field | Meaning |
| --- | --- |
| `file` | `name`, `sha256`, and the file's own `sample_rate`, `channels` and `frames` as libsndfile reads them. If Swift's decoder reports a different frame count, expect its times to be offset (MP3 encoder delay handling). |
| `gesture.start_sample`, `gesture.end_sample` | The single clean gesture (`note_segment()`), in samples at 44.1 kHz. `end_sample` is exclusive. |
| `gesture.start_s`, `gesture.end_s` | The same in seconds, relative to the original file. |
| `gesture.cut_at_reattack` | `true` if the gesture ends at a second attack rather than where the sound fades out. |
| `pitch_contour.midi` | The smoothed pYIN contour of the gesture, in MIDI, one value per hop of 256 samples at 44.1 kHz, `null` when unvoiced. `frames` is its length. See the smoothing steps below. |
| `pitch_estimate_midi` | The Recording Pitch estimate before audition (exact). `null` if there were too few voiced frames or the confidence was below 0.2. |
| `pitch_confidence` | 0 to 1, rounded to 2 decimals by the engine. |
| `recording_pitch_midi` | Recording Pitch (exact): `pitch_estimate_midi` if the Recording passed audition, else `null`. `recording_pitch_note` is the same as a note name with cents. |
| `shortest_note_s` | The shortest note the audition reads back within 40 cents: one of 0.12, 0.2, 0.35, 0.6. `null` for Noise-like Recordings. |
| `settle_s` | When the Recording settles on its pitch (`settle_time()`, #92), in seconds from the gesture start (exact). The whole gesture is played through the render path at its own pitch, as the audition does (`variable_resample`, tune 1), and read back by pYIN (frame 2048, hop 256, 45 to 900 Hz). It is the first frame `i` (time `i × 256 / 44100`) that starts 9 voiced frames in a row within ±50 cents of the Recording Pitch, or the gesture length if there is none. `null` for Noise-like Recordings. |
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
| `pitch_coverage` | `covered` and `total` distinct Song pitches ("2 of 6 notes covered"). |
| `transpose` | The transposition `melody_fit()` chose, in semitones. |
| `octave_moves` | How many Song pitches use an Octave Move. |
| `plan_cost` | The Arrangement's cost (exact), summed over covered pitches. See "The planner" below. |
| `per_pitch[]` | One entry per distinct Song pitch: `song_pitch`, `target_midi`, `recording`, `shift_semitones` (exact: target minus Recording Pitch) and `octave_move`. When no Recording covers the pitch, `recording`, `shift_semitones` and `octave_move` are `null`, and `target_midi` is the note still needed ("needs a fart near D3"). |
| `notes[]` | One entry per Song note, in order: `index`, `song_pitch`, `target_midi` (`song_pitch + transpose`), `recording` (the Recording id that plays it), `shift_semitones` (rounded to 2 decimals by the engine), `heard_cents` (`evaluate.py`'s read-back error for that note, `null` if unreadable), and `render` (`start_s`, `len_s`, `gain_db` from `render()`, for debugging a renderer port). |
| `max_abs_shift_semitones` | The largest per-note shift. |
| `metrics` | `evaluate.py`'s result on the reference render: `notes`, `pitch_readable_pct`, `within_50c_pct`, `within_50c_any_octave_pct`, `median_abs_cents`, `onsets_on_time_pct`, `notes_with_retrigger`, `distinct_recordings`, `on_pitch_pct` (#208), `sounding_pct` (the mean share of each note's time that sounds: 10 ms frames within 30 dB of the note's peak, #205) and `notes_mostly_silent` (notes under half sounding). |
| `render_settings` | `tune` 1.0 (the rate follows the Recording's pitch contour) and the Song's `bpm`. |

## `coverage.json`

`subsets[]`: each has `recordings` (the subset's ids) and `songs[]`, one per catalog Song: `song`, `unlocked`, `pitch_coverage`, `transpose`, `octave_moves`, `plan_cost` and `recording_for_pitch` (Song pitch as a string, to a Recording id or `null`). It's what a port's Pitch Coverage test compares with on every subset. Arrangements aren't rendered here.

## Tolerances for port tests

Test each stage on the golden outputs of the stage before it, so that one port's small differences don't fail the next port's test.

| Port | Input | Check |
| --- | --- | --- |
| Trimming (#34) | the fixture file | `gesture.start_s` and `gesture.end_s` within ±10 ms, and the same `cut_at_reattack` |
| Recording Pitch (#35) | the golden gesture | `pitch_estimate_midi` within ±30 cents, and a non-null estimate for the same Recordings |
| Audition (#36) | the golden gesture, `pitch_contour` and `pitch_estimate_midi` | The same `shortest_note_s`, and so the same Melodic set (`melodic`, `recording_pitch_midi`): 24 Melodic, `002 013 016 017 019 022 032 059 069 084 086 090 091 094 095 096 097 098 099 100 101 102 103 104` |
| Settle time (#92) | the golden gesture, `pitch_contour` and `recording_pitch_midi` | `settle_s` within 2 frames (11.6 ms) |
| Song import (#38) | the catalog MIDI | Same note count and pitches; `start` and `dur` within 1e-6 beats; the same `bpm` and `beats_per_bar` |
| Auto-map (#40) and Pitch Coverage (#43) | the golden `recording_pitch_midi`, `shortest_note_s`, `settle_s`, `melodic`, gesture length and Song `notes` | The Arrangement matches (next section), for both libraries and every `coverage.json` subset |
| Renderer (#41) | a golden Arrangement | The same checks as `evaluate.py`, no worse than the golden metrics (see "Metrics" below) |

### When an Arrangement matches

The planner breaks every tie with a rule on the result (see "The planner" below), so the golden Arrangement is unique and a port can match it exactly. An Arrangement matches the golden one when:

- `unlocked`, `pitch_coverage`, `transpose` and `octave_moves` are identical;
- each pitch's Recording is identical (`per_pitch[].recording`, or `recording_for_pitch` in `coverage.json`), `null` included;
- every `per_pitch[].shift_semitones` is within 1e-9;
- the cost **recomputed from the Arrangement under test** is within 1e-9 of `plan_cost` (see below);
- for an Unlocked Song, each note's `target_midi` and `recording` are identical. Every note of one Song pitch uses the same Recording.

Recompute the cost from the Arrangement under test, never take the solver's own total. Use its transposition, its Recording for each distinct Song pitch, the golden inputs, and the planner's terms. [`tools/melody-lab/golden_cost.py`](../../tools/melody-lab/golden_cost.py) does this in `arrangement_cost()`, which also checks that no Recording plays two pitches and that every move is allowed, and a Swift test can port it.

Why it matters: `013` and `086` have exactly the same Recording Pitch (55.825920593660186), and so do `016` and `022` (40.325920593660186), so `index.json` lists them as tie groups. A port that looks Recordings up by Recording Pitch could put both tied pitches on `013`. That is no longer one to one, so `arrangement_cost()` rejects it. The members of each group settle at different times (`settle_s` 0.139 and 0.012 s, and 0.046 and 0.035 s), so since #92 their costs differ: across the 8 other ways to place a group's Recordings on the pitches it plays in the 13 full-library Arrangements, none is a true tie, and each costs at least 27.63 more. A coverage subset can still produce true ties, and a port whose solver breaks ties differently still needs the tie-break to match.

Checked against the reference itself before #208, and not rechecked since the silence cost (#205) joined the planner's cost: shuffling the library order 30 times per Song, on both libraries, gives the identical Arrangement (exact ids) every time. A brute-force search over every transposition and every one-to-one choice agrees with `melody_fit()` on 3,648 fits (the 12 app Songs on random subsets of up to 9 Recordings, with and without Octave Moves). Since the third batch joined the Fixture Library (#219), the smallest cost gap between the chosen transposition and the next best one with the same coverage and Octave Moves is 0.64 (`saints`, full library, −21 against −20), and 1.26 on the small library (`furelise`, locked, −28 against −29), far above the 1e-9 tie tolerance. `export_golden.py` runs `golden_cost.py` on every golden fit after every export, so the two can't drift apart.

### Near-threshold Recordings

A few Recordings sit close to a decision threshold, so a tiny difference in a Swift port can flip them. If one of these fails, check the threshold arithmetic first.

- **Re-attack cut (#34)** requires a rise of more than 4 dB after the level dips more than 6 dB below its running maximum. Moving the rise threshold changes these gestures by far more than 10 ms:
  - to 4.5 dB: `080` is no longer cut (end 2.015 to 2.529 s), and `002` and `067` are cut at a later re-attack (1.951 to 2.454 s, and 1.028 to 1.207 s);
  - to 5 dB: `052` is no longer cut either (0.454 to 0.713 s);
  - to 3 dB: `022` gets cut (2.000 to 1.412 s). At 3.5 dB nothing changes.

  Moving the dip threshold by ±0.5 dB changes nothing.
- **Pitch confidence (#35)** threshold is 0.2: `009` is at 0.1 (Noise-like; it reads an octave and more off with independent trackers), and the lowest Melodic Recording, `094`, is at 0.3.
- **Audition (#36)** passes within 40 cents. Every Melodic Recording reads back within 20 cents at its `shortest_note_s` and every longer length (`103` +20 and `101` −15 at 0.12 s, every other within 10), and every shorter length reads more than 500 cents off or unvoiced, so none is near the threshold.
- **Contour center (#208)**: frames more than 6 semitones from the gesture's center are dropped, 2 to 20 frames on 8 fixtures (`013`, `019`, `022`, `032`, `069`, `080`, `094`, `103`). The same 24 are Melodic without the step and at any distance from 2 to 12 semitones. From 8 to 12 semitones, and without the step, `069`'s and `103`'s Recording Pitches move 10 cents; without the step `013`'s also moves 10 cents and its `shortest_note_s` drops from 0.35 to 0.2. At 2 to 5 semitones, up to 8 fixtures change, by up to 1.3 semitones. The step can also empty the first 450 ms, a second way to be Noise-like: `080`'s confidence is 0.15 without it and 0.00 with it (under the 0.2 bar either way).
- **Renderer (#41)** requires at least 94% of notes within ±50 cents. No note in the 13 full-library Arrangements reads within 37 cents of ±50, and all 13 read 100%.
- **Too-short notes (#40)**: a note counts as too short when it sounds for less than the Recording's `shortest_note_s`, and the note's length comes from `dur × 60 / bpm − 0.025`, or from the gesture length × 2^(−shift/12). A port that computes these slightly differently can flip a note that sits right at the threshold, which changes `plan_cost` by at least 8. Use the same arithmetic as `too_short_cost()`.

### Metrics

The metrics are the reference renderer's result on its own render, not an exact target. Two of them mostly measure pYIN's 10-cent grid, not the renderer: `median_abs_cents` is exactly 2.6 for every full-library Song but `row` (7.4), and 375 of the 386 readable `heard_cents` values round from 2.6 plus a multiple of 10. A Swift evaluator with a continuous pitch estimate will give different numbers for both. So "no worse than golden" applies only to `within_50c_pct`, `onsets_on_time_pct` and `notes_with_retrigger`. The absolute bars stay ADR 0004's: notes within ±50 cents, onsets within ±50 ms, and no second attack inside a note.

`on_pitch_pct` (#208) is the share of loud frames inside notes (within 20 dB of the note's loudest, 12 ms in from either end) that YIN reads within 50 cents of the note, leaving out frames more than 9 semitones off. YIN reads every frame with no voicing decision, so it hears a note bend in from its attack, which the per-note pYIN median above smooths over. It is information, not a bar: 86 to 98% on the full library.

On the small library, every unlocked Song reads at or above the 94% bar. Before `022` replaced `021` there (#215), pYIN read `ode` and `ode-mutopia` 93%: no pitch on notes 9 and 24, which `016` played (0.30 s, 0.67 semitones up), though YIN and plain autocorrelation read them within 1 cent. Before #205 `jingle` read 81% the same way (notes 11 to 15, 0.17 s on `016` with an Octave Move up). On `saints` (97%), note 22, 0.175 s on `069`, is off: +243 cents by pYIN, +44 by YIN and +227 by plain autocorrelation, while note 21, the same Recording held 0.375 s, reads within 3 cents by all three. Before #208 every small-library Song was locked. `evaluate_renders.py` checks the full library only.

## The planner (#43)

The reference planner follows the unlock rule in [ADR 0004](../../docs/adr/0004-fart-only-rendering.md) and [ADR 0006](../../docs/adr/0006-octave-moves.md). `melody_fit()` gives Pitch Coverage and the Arrangement in one search; `plan()` turns an Unlocked Song's Arrangement into notes, and raises `SongLocked` for a locked one.

- **Allowed moves.** Each distinct Song pitch gets its own Melodic Recording, and a Recording plays at most one pitch. Its shift (target minus Recording Pitch) is at most 3 semitones either way, or at most 3 from ±12 (an Octave Move, up or down on equal terms; ADR 0006 records why). Every transposition from −36 to +24 is tried.
- **Ranking.** Arrangements compare by the fewest uncovered pitches (the most Pitch Coverage), then the fewest Octave Moves, then the lowest cost, where costs within 1e-9 are equal. Then the Recording ids, read in ascending Song pitch order, lexicographically smallest, with an uncovered pitch sorting after every id. Then the lower transposition. Sorting the library before the solver isn't enough, because a different solver can break the same tie differently.
- **Cost**, per covered pitch, summed in ascending pitch order:
  - weight × move cost. The weight is the summed duration in beats of the notes at that pitch. The move cost per beat is |shift|^1.5 within 3 semitones, or 6 + |shift ∓ 12|^1.5 for an Octave Move, so an Octave Move always costs more than any real-pitch move (3^1.5 = 5.2).
  - for each note at that pitch that sounds for less than the Recording's `shortest_note_s`: 8, plus 400 per second it falls short. A note sounds for `dur × 60 / bpm − 0.025` seconds, or for the Recording's gesture length × 2^(−shift/12) when that's shorter: an Octave Move up halves it.
  - for each note at that pitch, 20 × the share of its sounding time that comes before the Recording settles (#92): `20 × min(sounds, settle_s × 2^(−shift/12)) / sounds`, with `sounds` as above. A short note on a fart that scoops or glides into its pitch costs up to 20; the same fart on a long note costs little.
  - 30 × the seconds of silence the Recording leaves in that pitch's notes (#205): `30 × Σ max(0, (dur × 60 / bpm − 0.025) − gesture length × 2^(−shift/12))`, summed over the notes first and then multiplied. A long note prefers a long Recording.
- **Unlocking is pitch-only.** Note length changes the cost, never whether a Song unlocks.

What changed from the planner before #43: no Recording is reused (the reuse penalty of 2 is gone), no shift goes beyond 3 semitones except with an Octave Move (the old shift cost allowed up to 12), the too-short cost grows with how far short a note falls and counts the Recording's own length, and ties are broken by the rule above. #92 added the settle cost, and #205 the silence cost. `golden_cost.py` must change with any cost term; the export fails until they agree. `recordings/` and `songs/` don't depend on the planner.
