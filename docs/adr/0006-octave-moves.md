# Octaves: Songs may use Octave Moves, and every pitch shows its octave

A Recording Pitch is a real pitch, octave included: a G2 fart and a G3 fart are different notes. Under ADR 0004 every distinct Song pitch needed its own Melodic Recording within 3 semitones, under the Song's best transposition, so the spread of a user's farts decided what unlocked. With all 9 Melodic fixtures only 6 of 12 Songs unlocked, and 6 random Melodic farts unlocked 1.3 on average. The product owner made three decisions on 2026-10-05 and 2026-10-06 (#68), after the research report there.

1. **Unlock rule and Auto-map: Octave Moves where a Song needs them.** A Song is unlocked when, under its best transposition, every distinct pitch gets its own Melodic Recording (one to one) that is either within 3 semitones of it, or within 3 semitones of the same note an octave up or down. In that second case the Recording makes an Octave Move: it is resampled by 12 semitones plus at most 3, up or down. Real-pitch matches come first: Auto-map uses as few Octave Moves as the Song allows, and only then picks the closest shifts. Pitch Coverage is the size of the largest such matching ("3 of 4 notes covered"). Octave Moves go up or down on equal terms (measured below). Moves of more than one octave, and placing a fart in another octave without resampling it, are never used.
2. **Display: a piano roll fitted to the range.** It replaces the 12-key strip, which hid octaves. A vertical keyboard labeled with octaves (C3, G2) runs from the lowest note shown to the highest, with no padding rows. On Result each Melodic Recording is a bar in its note's row, the new one outlined. A locked Song (Compose) shows its melody on the same roll: notes you have are filled, notes still needed are dashed. The Recordings tab has no roll; each row shows the note as a pill with its octave ("B3"), as the owner chose in #72.
3. **Octave errors: one pitch tracker, pYIN.** A second tracker made nothing measurably more accurate on the Fixture Library (measured below).

The owner left the last two choices, which octave directions to allow and whether to add a second tracker, to whichever measured higher quality (#79, #81, 2026-10-06).

## Why

Songs unlocked (of 12) under each rule in #68's measurements, a mean of 30 random Fixture Library subsets. "Pass" is ADR 0004's checks on every distinct Unlocked Song's render (at least 94% of notes within ±50 cents and on time within ±50 ms, and no second attack inside a note).

| Rule | 3 farts | 6 | 9 | all 23 | 6 Melodic | Toots pass |
|---|---|---|---|---|---|---|
| Within 3 semitones (ADR 0004) | 0 | 0 | 0.1 | 6 | 1.3 | 90% of 29 |
| Within 5 | 0 | 0 | 0.3 | 9 | 2.0 | 91% of 55 |
| Within 7 | 0 | 0 | 0.6 | 12 | 5.4 | 83% of 156 |
| **Octave Moves where needed (chosen)** | 0 | 0.2 | 1.0 | 12 | 6.6 | 80% of 207 |
| Other octave, no resampling | 0 | 0.2 | 1.0 | 12 | 6.7 | 9% of 206 |

- Octave Moves unlock the most Songs with the fewest farts, and on the same Songs and farts they pass about as often as shifts of up to 7 semitones (80% against 82% over 132 pairs). CREPE, independent of pYIN, heard 963 of 1,007 octave-moved notes within 50 cents and none an octave off.
- Placing a fart in another octave without resampling breaks the tune: listeners can't follow a melody whose notes are scattered across octaves (Deutsch 1972).
- The cost: an Octave Move plays the fart at double or half speed. 63% of them speed a low fart up, which halves its length. That is why real-pitch matches come first.
- Random farts are mostly Noise-like: 3, 6 or 9 random fixtures hold only 1.2, 2.3 or 3.4 Melodic ones, and Songs need 4 to 8. No rule unlocks anything before about 6 Melodic farts.

## Measured: which directions Octave Moves may go

The reference planner (#81) was run with four rules, each on the same 30 random subsets per size of the 23 fixtures, rendered and read back with `evaluate.py`. Each figure counts every (subset, Song) a user would get, so a Toot that comes up often counts more. "Pass" uses ADR 0004's checks. "On pitch" is the share of all notes within ±50 cents.

| Rule | Songs unlocked, 6 Melodic farts | Pass, 6 Melodic farts | On pitch, 6 Melodic farts | Pass, 6 and 9 random farts | All 23 farts |
|---|---|---|---|---|---|
| **Up or down, equal terms (chosen)** | **6.83** | **184 of 205 (90%)** | 97.2% | 24 of 30 | 12 unlocked, 12 pass |
| Up only | 5.83 | 150 of 175 (86%) | 97.2% | 18 of 20 | 12 unlocked, 12 pass |
| Down only when the Song can't be covered otherwise | 6.83 | 179 of 205 (87%) | 97.4% | 27 of 30 | 12 unlocked, 12 pass |
| Down only for a note that no real-pitch or upward fart reaches | 5.93 | 149 of 178 (84%) | 96.9% | 17 of 20 | 12 unlocked, 12 pass |

Across every distinct Toot rendered under equal terms, these shares of notes were on pitch:

| Notes | On pitch |
|---|---|
| Moved up an octave | 563 of 568 (99.1%) |
| Real pitch | 3,900 of 4,008 (97.3%) |
| Moved down an octave | 576 of 629 (91.6%) |

Notes moved down are the weakest. Even so, steering away from them makes the whole Toot worse: the planner then has to put up-moves and real-pitch notes on farts that fit them less well. Compared with equal terms on the same Unlocked Songs, using down only as a last resort makes 12 Toots fail and 10 pass. Its on-pitch gain is 0.2 points. The two rules that restrict down moves unlock one Song fewer per 6 Melodic farts, and they pass less often. So no restriction showed a clear quality gain, and equal terms stays.

## Measured: a second pitch tracker

#68 proposed CREPE tiny (about 2 MB, which could run on the phone through Core ML) as a second tracker. A Recording would become Noise-like when it and pYIN disagree by an octave. On the 9 Melodic fixtures, the candidates that could run in Swift were measured: YIN, Praat autocorrelation, SWIPE′ and RAPT, which are signal-processing methods, and CREPE tiny, which is Core ML.

- **Octave:** every candidate puts all 9 in the same octave as pYIN. The octave check would catch nothing and wrongly reject nothing.
- **Cents, on what Toots play:** each fixture was rendered at its own Recording Pitch (0.35 and 0.6 s, the real render path) and read back by trackers independent of pYIN:

  | Tracker | Within ±50 cents of pYIN's Recording Pitch | Worst |
  |---|---|---|
  | SWIPE′ | 18 of 18 | 13 cents |
  | CREPE full | 18 of 18 | 14 cents |
  | CREPE tiny | 18 of 18 | 28 cents |
  | Praat | 17 of 18 | 61 cents |
  | RAPT | 17 of 18 | 62 cents |
  | YIN | 17 of 18 | 86 cents |

  The Praat, RAPT and YIN outliers are all the same note, `017` at 0.35 s, its shortest playable note.
- **The raw sound:** on two gliding farts, `017` (+140 cents) and `019` (−118 cents), pYIN's Recording Pitch differs from the other trackers' median. pYIN hears only part of the glide. This doesn't reach Toots, because the renderer holds each note at the Recording Pitch and independent trackers hear the result in tune. With no human pitch labels for the raw farts, there's no ground truth showing which reading is better.
- **A different possible gain, not measured on Toots yet:** two of the 14 Noise-like fixtures may hold a steady pitch that pYIN misses.
  - `055` gets no pYIN estimate. Four candidates agree on 52.4 to 52.8 and pass an audition read back by SWIPE′ and CREPE full.
  - `002` sits just under pYIN's confidence bar (0.09 against 0.1). Every candidate agrees on about 46.3.

  That could make 11 Melodic fixtures instead of 9, but nothing shows yet that Toots on them pass ADR 0004's checks. Lowering pYIN's bar alone would also admit `022`, which the independent readers reject. #83 measures this before anything is built.
  Update 2026-10-25 (#208): Recording Analysis no longer drops the frames pYIN is unsure of, and the confidence bar is 0.2. 15 fixtures are Melodic, `002` and `022` among them, and `055` stays Noise-like. YIN and autocorrelation read each of the 15 within 20 cents of its Recording Pitch. On the full Fixture Library every unlocked Song passes ADR 0004's checks (`fixtures/golden/`). On the small library pYIN can't read some short notes on `016` (`ode` 93%, and `jingle` 81% before #205); YIN and autocorrelation read them within 3 cents (`fixtures/golden/README.md`).

## Consequences

- ADR 0004's limit ("shifted by at most 3 semitones ... a larger shift is never used") is replaced by rule 1. The rest of ADR 0004 stands: an Octave Move is variable-rate resampling, so rendering is still trim, resample, fade, gain and mix.
- The reference planner, `plan()` in `tools/melody-lab/`, follows rule 1 from #43, which re-exports `fixtures/golden/`. The Swift ports follow it: Auto-map (#40) and Pitch Coverage (#43's Swift part, then #44 on the Songs screen).
- Notes still needed are real pitches with their octave ("Needs a fart near D3"). A fart near D2 or D4 also covers that note.
- If real users' farts show octave errors, revisit 3. #83 checks the separate question of whether a second tracker should make some Noise-like Recordings Melodic.
