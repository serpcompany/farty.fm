# Octaves: Songs may use Octave Moves, and every pitch shows its octave

A Recording Pitch is a real pitch, octave included: a G2 fart and a G3 fart are different notes. Under ADR 0004 every distinct Song pitch needed its own Melodic Recording within 3 semitones, under the Song's best transposition, so the spread of a user's farts decided what unlocked. With all 9 Melodic fixtures only 6 of 12 Songs unlocked, and 6 random Melodic farts unlocked 1.3 on average. The product owner made three decisions on 2026-10-05 and 2026-10-06 (#68), after the research report there.

1. **Unlock rule and Auto-map: Octave Moves where a Song needs them.** A Song is unlocked when, under its best transposition, every distinct pitch gets its own Melodic Recording (one to one) that is either within 3 semitones of it, or within 3 semitones of the same note an octave up or down. In that second case the Recording makes an Octave Move: it is resampled by 12 semitones plus at most 3, up or down. Real-pitch matches come first: Auto-map uses as few Octave Moves as the Song allows, and only then picks the closest shifts. Pitch Coverage is the size of the largest such matching ("3 of 4 notes covered"). Moves of more than one octave, and placing a fart in another octave without resampling it, are never used.
2. **Display: a piano roll fitted to the range.** It replaces the 12-key strip, which hid octaves. A vertical keyboard labeled with octaves (C3, G2) runs from the lowest note shown to the highest, with no padding rows. On Result each Melodic Recording is a bar in its note's row, the new one outlined. A locked Song (Compose) shows its melody on the same roll: notes you have are filled, notes still needed are dashed. The Recordings tab has no roll; each row shows the note as a pill with its octave ("B3"), as the owner chose in #72.
3. **Octave errors: pYIN stays the only pitch tracker for now.** Five other trackers (Praat autocorrelation, SWIPE′, RAPT, CREPE full and CREPE tiny) put all 9 Melodic fixtures in the same octave as pYIN, so a second tracker would change nothing on today's fixtures.

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

## Consequences

- ADR 0004's limit ("shifted by at most 3 semitones ... a larger shift is never used") is replaced by rule 1. The rest of ADR 0004 stands: an Octave Move is variable-rate resampling, so rendering is still trim, resample, fade, gain and mix.
- The reference planner, `plan()` in `tools/melody-lab/`, follows rule 1 from #43, which re-exports `fixtures/golden/`. The Swift ports follow it: Auto-map (#40) and Pitch Coverage (#43's Swift part, then #44 on the Songs screen).
- Notes still needed are real pitches with their octave ("Needs a fart near D3"). A fart near D2 or D4 also covers that note.
- If real users' farts show octave errors, revisit 3. The candidate is CREPE tiny (about 2 MB), calling a Recording Noise-like when it and pYIN disagree by an octave.
