# Noise-like farts play Beats on bar lines

Until #262 a Noise-like Recording played no part in a Song. It has no steady pitch, so Pitch Coverage and Auto-map never use it (ADR 0004), and a user whose farts were mostly noise-like heard none of them in their Toots. On 2026-10-28 the product owner decided that Noise-like Recordings play in Songs as Beats.

1. **One Beat per bar.** A Beat is a Noise-like Recording played at the start of each bar, on the score's bar lines (`bar_lines`), at the Song's `bpm`. A pickup before the first bar line gets no Beat.
2. **They take turns.** With several Noise-like Recordings, bar k plays number k mod n, the Recordings sorted by id as Auto-map sorts them (`compareIds`). A Toot keeps the ones that play, in that order (`beatRecordings`), which is never more than the Song has bars.
3. **Fart-only, raw (ADR 0004, ADR 0012).** A Beat is rendered like a note: the fart from the start of its gesture, cut at the next bar line less the 25 ms gap (at least 60 ms) or where the fart ends, faded, set to a level and mixed. Bar lines get no accent: the 1.5 dB accent stays on melody notes only. Nothing is looped, stretched, re-triggered or synthesized.
4. **Under the melody.** A Beat's level is `BEAT_DB` = −15 dB against a note's: −20 dB RMS over the fart's first 0.25 s, less 15 dB. The measurements below set it.
5. **Nothing else changes.** Pitch Coverage, unlocking and Auto-map's choices are the Melodic Recordings', as before. A library with no Noise-like Recordings renders byte for byte as it did.
6. **What the app shows.** No new controls. Each Recording that plays the Beats joins Song Creator's Recordings used, labeled "Beat"; tapping it plays it alone. The line above them counts them: "9 of your Recordings: one per note, and 2 for the Beats". A Toot without Beats, including every Toot made before them, still says "7 of your Recordings, one per note".

`plan_beats()` and `render()` in `tools/melody-lab/engine.py` define this, and `apps/web/src/lib/engine/beats.ts` and `renderer.ts` match them. `evaluate.py` measures the melody notes only, with the Beats sounding, so the bar (ADR 0012) still applies to the melody. `fixtures/golden/` is format 7, with each Arrangement's `beats`. Swift isn't changed.

## Placements ruled out

- **A Beat on every beat of the meter.** Three or four farts a bar crowd the melody, and the owner chose one per bar.
- **Filling the notes no Melodic Recording covers.** A noise-like fart can't tell the listener which note it is (ADR 0004), and it would change what unlocks a Song. The owner kept Pitch Coverage as it is.

## Why −15 dB

The owner asked to start at −6 dB and lower the level until the melody still reads on pitch. The 9 Songs the goldens unlock with the full Fixture Library (24 Melodic and 8 Noise-like Recordings, 270 melody notes) were rendered on the reference at each level and read back with `evaluate.py`. "Heard off" counts the notes whose pitch, as pYIN reads it, moved more than 50 cents from the same render without Beats. "Off their fart" counts the notes whose fidelity reading (ADR 0012) moved more than 50 cents. A Song is under the bar when it reads below 94% fidelity or 95% of onsets on time, or has a re-attack.

| Beat level | Lowest fidelity | Lowest onsets on time | Re-attacks | Notes heard off | Notes off their fart | Songs under the bar |
|---|---|---|---|---|---|---|
| 0 dB | 77% | 81% | 6 | 55 of 270 | 35 of 270 | 9 of 9 |
| −3 dB | 81% | 81% | 5 | 47 | 28 | 7 |
| −6 dB | 84% | 91% | 3 | 37 | 20 | 6 |
| −9 dB | 91% | 97% | 0 | 26 | 12 | 4 |
| −10 dB | 92% | 97% | 0 | 21 | 6 | 1 (Happy Birthday) |
| −11 dB | 97% | 97% | 0 | 17 | 3 | 0 |
| −12 dB | 100% | 94% | 0 | 14 | 0 | 1 (Frère Jacques) |
| −13 dB | 100% | 97% | 0 | 7 | 0 | 0 |
| −14 dB | 100% | 97% | 0 | 3 | 0 | 0 |
| **−15 dB (chosen)** | **100%** | **97%** | **0** | **1** | **0** | **0** |
| −18 dB | 100% | 100% | 0 | 1 | 0 | 0 |

−15 dB is the loudest level at which the melody reads as it does under quieter Beats: one note in 270 heard more than 50 cents off (in Happy Birthday; at −18 dB one note moves too, in When the Saints Go Marching In), every Song at 100% fidelity, and no re-attacks. One Frère Jacques onset of 32 reads late (97%, against 100% without Beats). With the Beats at −15 dB, the goldens' metrics (`fixtures/golden/README.md`) change only here, and no note's placement changes:

| Song | Beats | Metrics that changed, without Beats → with |
|---|---|---|
| Frère Jacques | 8 | `onsets_on_time_pct` 100 → 97, `on_pitch_pct` 16 → 15, `sounding_pct` 97 → 98 |
| We Wish You a Merry Christmas | 10 | `median_abs_cents` 52.6 → 60.1, `within_50c_pct` and `within_50c_any_octave_pct` 44 → 42 |
| Happy Birthday | 8 | `median_abs_cents` 217.4 → 212.4, `sounding_pct` 96 → 97 |
| Für Elise | 8 | `median_abs_cents` 119.9 → 117.4, `sounding_pct` 94 → 96 |
| When the Saints Go Marching In | 9 | `sounding_pct` 95 → 96 |
| Mary Had a Little Lamb, Ode to Joy, Ode to Joy (Mutopia SATB), Twinkle, Twinkle, Little Star | 4, 8, 8, 8 | none |

## Where a Beat lands

Fixture 065, a Noise-like Recording, was added to the Melodic Fixture Library less 032, so that We Wish You a Merry Christmas plays 065 on its Beats and Auto-map puts 090 on its notes. In the web engine's render, 065's 10 onsets fall on the Song's 10 bar lines (within 6 ms by onset detection, and to the sample by a matched filter for 065's start) and nowhere else, and the pickup has no Beat. `evaluate.py` reads the melody the same with and without the Beats.

## Consequences

- **Every Song that unlocks with the full Fixture Library has Beats in its golden,** 4 to 10 of them. The small Fixture Library unlocks no Song, so its goldens have `beats: null`.
- **A Toot keeps the Recordings that play its Beats** (`beatRecordings` in its Arrangement), and a signed-in browser syncs them with the Toot. A Toot from before Beats has none, and loads as before.
- **A deleted Beat Recording** shows as "Recording deleted" with its "Beat" label, as a deleted note's Recording shows what it played.
- **The iPhone app has no Beats.** The owner kept Swift out of #262, so `Renderer.swift` no longer matches the reference for a library with Noise-like Recordings.
