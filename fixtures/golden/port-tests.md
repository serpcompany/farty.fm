# Testing a port against the golden data

How the web app's port (`apps/web/src/lib/analysis/` and `src/lib/engine/`) checks itself against the [golden data](README.md), whose fields that README describes.

## Tolerances

Test each stage on the golden outputs of the stage before it, so that one port's small differences don't fail the next port's test.

| Port | Input | Check |
| --- | --- | --- |
| Trimming (#34) | the fixture file | `gesture.start_s` and `gesture.end_s` within ±10 ms, and the same `cut_at_reattack` |
| Recording Pitch (#35) | the golden gesture | `pitch_estimate_midi` within ±30 cents, and a non-null estimate for the same Recordings |
| Audition (#36) | the golden gesture, `pitch_contour` and `pitch_estimate_midi` | The same `shortest_note_s`, and so the same Melodic set (`melodic`, `recording_pitch_midi`): 24 Melodic, `002 013 016 017 019 022 032 059 069 084 086 090 091 094 095 096 097 098 099 100 101 102 103 104` |
| Settle time (#92) | the golden gesture, `pitch_contour` and `recording_pitch_midi` | `settle_s` within 2 frames (11.6 ms) |
| Song import (#38) | the catalog MIDI | Same note count and pitches; `start` and `dur` within 1e-6 beats; the same `bpm`, `beats_per_bar` and `bar_lines` |
| Auto-map (#40) and Pitch Coverage (#43) | the golden `recording_pitch_midi`, `shortest_note_s`, `settle_s`, `melodic`, gesture length and Song `notes` | The Arrangement matches (next section), for both libraries and every `coverage.json` subset |
| Renderer (#41) | a golden Arrangement | The same checks as `evaluate.py`, no worse than the golden metrics (see "Metrics" below) |

## When an Arrangement matches

The planner breaks every tie with a rule on the result (see [The reference planner](planner.md)), so the golden Arrangement is unique and a port can match it exactly. An Arrangement matches the golden one when:

- `unlocked`, `pitch_coverage`, `transpose`, `octave_moves` and `missing` are identical;
- each pitch's Recording is identical (`per_pitch[].recording`, or `recording_for_pitch` in `coverage.json`), `null` included;
- every `per_pitch[].shift_semitones` is within 1e-9;
- the cost **recomputed from the Arrangement under test** is within 1e-9 of `plan_cost` (see below);
- for an Unlocked Song, each note's `target_midi` and `recording` are identical. Every note of one Song pitch uses the same Recording.

Recompute the cost from the Arrangement under test, never take the solver's own total. Use its transposition, its Recording for each distinct Song pitch, the golden inputs, and the planner's terms. [`tools/melody-lab/golden_cost.py`](../../tools/melody-lab/golden_cost.py) does this in `arrangement_cost()`, which also checks that no Recording plays two pitches and that every move is allowed (near enough in pitch, and long enough for the pitch's longest note), and the web app's Auto-map test ports it (`auto-map.test.ts`).

Why it matters: `013` and `086` have exactly the same Recording Pitch (55.825920593660186), and so do `016` and `022` (40.325920593660186), so `index.json` lists them as tie groups. A port that looks Recordings up by Recording Pitch could put both tied pitches on `013`. That is no longer one to one, so `arrangement_cost()` rejects it. The members of each group settle at different times (`settle_s` 0.139 and 0.012 s, and 0.046 and 0.035 s), so since #92 their costs differ, and since ADR 0011 their lengths decide too: `016` lasts 0.31 s and `022` 1.37 s, `086` 0.24 s and `013` 1.09 s. In the 13 full-library Arrangements a group's other Recording can take a pitch in 14 ways, and all 14 put `016` or `086` on a note longer than it lasts, which the length rule forbids (checked after ADR 0012). A coverage subset can still produce true ties, and a port whose solver breaks ties differently still needs the tie-break to match.

Checked against the reference itself before #208, and not rechecked since the silence cost (#205) joined the planner's cost: shuffling the library order 30 times per Song, on both libraries, gives the identical Arrangement (exact ids) every time. A brute-force search over every transposition and every one-to-one choice agrees with `melody_fit()` on 3,648 fits (the 12 app Songs on random subsets of up to 9 Recordings, with and without Octave Moves). Since farts play at their own length (ADR 0012), the smallest cost gap between the chosen transposition and the next best one with the same coverage and Octave Moves is 0.25 on the full library (`amazing`, locked, −21 against −26; 11.22 among the unlocked Songs, `furelise`, −28 against −27), and 2.10 on the small library (`twinkle`, locked, −27 against −28), far above the 1e-9 tie tolerance. `export_golden.py` runs `golden_cost.py` on every golden fit after every export, so the two can't drift apart.

## Near-threshold Recordings

A few Recordings sit close to a decision threshold, so a tiny difference in a port can flip them. If one of these fails, check the threshold arithmetic first.

- **Re-attack cut (#34)** requires a rise of more than 4 dB after the level dips more than 6 dB below its running maximum. Moving the rise threshold changes these gestures by far more than 10 ms:
  - to 4.5 dB: `080` is no longer cut (end 2.015 to 2.529 s), and `002` and `067` are cut at a later re-attack (1.951 to 2.454 s, and 1.028 to 1.207 s);
  - to 5 dB: `052` is no longer cut either (0.454 to 0.713 s);
  - to 3 dB: `022` gets cut (2.000 to 1.412 s). At 3.5 dB nothing changes.

  Moving the dip threshold by ±0.5 dB changes nothing.
- **Pitch confidence (#35)** threshold is 0.2: `009` is at 0.1 (Noise-like; it reads an octave and more off with independent trackers), and the lowest Melodic Recording, `094`, is at 0.3.
- **Audition (#36)** passes within 40 cents. Every Melodic Recording reads back within 20 cents at its `shortest_note_s` and every longer length (`103` +20 and `101` −15 at 0.12 s, every other within 10), and every shorter length reads more than 500 cents off or unvoiced, so none is near the threshold.
- **Contour center (#208)**: frames more than 6 semitones from the gesture's center are dropped, 2 to 20 frames on 8 fixtures (`013`, `019`, `022`, `032`, `069`, `080`, `094`, `103`). The same 24 are Melodic without the step and at any distance from 2 to 12 semitones. From 8 to 12 semitones, and without the step, `069`'s and `103`'s Recording Pitches move 10 cents; without the step `013`'s also moves 10 cents and its `shortest_note_s` drops from 0.35 to 0.2. At 2 to 5 semitones, up to 8 fixtures change, by up to 1.3 semitones. The step can also empty the first 450 ms, a second way to be Noise-like: `080`'s confidence is 0.15 without it and 0.00 with it (under the 0.2 bar either way).
- **Renderer (#41)** requires at least 94% of notes within ±50 cents of their fart's own pitch (ADR 0012). All 9 unlocked full-library Arrangements read 100%, and no note's `fart_cents` is beyond ±2 cents, so nothing sits near the bar. A render that moves its farts' pitch more than 50 cents on more than 6% of notes fails it: the pitch-held render the app used before ADR 0012 read 0 to 25% on the 11 Songs it unlocked.
- **Too-short notes (#40)**: a note counts as too short when it sounds for less than the Recording's `shortest_note_s`, and the note's length comes from `dur × 60 / bpm − 0.025`, or from the gesture length when that's shorter. A port that computes these slightly differently can flip a note that sits right at the threshold, which changes `plan_cost` by at least 8. Use the same arithmetic as `too_short_cost()`.

## Metrics

The metrics are the reference renderer's result on its own render, not an exact target. The bar is [ADR 0012](../../docs/adr/0012-songs-play-farts-raw.md)'s: at least 94% of notes within ±50 cents of their fart's own pitch (`within_50c_of_fart_pct`), at least 95% of onsets within ±50 ms, and no second attack inside a note. "No worse than golden" applies to those three. `within_50c_of_fart_pct` compares each note with its own fart played dry: YIN (frame 2048, hop 256, 45 to 1200 Hz) reads the render and the dry fart on the same frame grid, and a note is faithful when the median of the per-frame differences over its loud frames (within 20 dB of the note's loudest, 12 ms in from either end) is within ±50 cents. YIN reads frame by frame with no voicing decision, so the same samples read the same in both, and the per-frame median survives a fart that YIN reads an octave apart on alternate frames (`032`).

How close a Song sounds to its tune is reported, not gated, since Songs play farts raw: `median_abs_cents` (pYIN's per-note read-back distance from the note; 53 to 287 cents on the full library), `within_50c_pct` (0 to 44%) and `contour_pct` (40 to 90%). pYIN reads on a 10-cent grid, so an evaluator with a continuous pitch estimate will give different numbers for these.

`on_pitch_pct` (#208) is the share of loud frames inside notes that YIN reads within 50 cents of the note, leaving out frames more than 9 semitones off. It is information, not a bar: 3 to 22% on the full library (83 to 97% when farts were pitch-held).

On the small library no Song unlocks. Before raw playing (ADR 0012) `mary` unlocked there, with `090` (0.48 s) moved down 14.2 semitones by an Octave Move and so lasting 1.08 s on 0.69 s notes. Played raw it lasts 0.48 s, and no other transposition covers every pitch: `022` (1.37 s) falls just short of the 1.40 s note. Before the length rule (ADR 0011) `jingle`, `saints`, `ode` and `ode-mutopia` unlocked there too, each with a Recording shorter than some of its notes. Before `022` replaced `021` there (#215), pYIN read `ode` and `ode-mutopia` 93%: no pitch on notes 9 and 24, which `016` played (0.30 s, 0.67 semitones up), though YIN and plain autocorrelation read them within 1 cent. On `saints` (97% then), note 22, 0.175 s on `069`, was off: +243 cents by pYIN, +44 by YIN and +227 by plain autocorrelation, while note 21, the same Recording held 0.375 s, read within 3 cents by all three. That attack is why `NOTE_FILL` is 1.0 and not 0.9 (ADR 0011). Before #208 every small-library Song was locked. `evaluate_renders.py` checks the full library only.
