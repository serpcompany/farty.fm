# A second pitch window, and Re-scan

Until #282 Recording Analysis read a fart's pitch from the first 450 ms of its first burst only. A fart whose tone starts later had no note: the Recordings tab marked it noise-like, and Songs left it out unless it was placed by ear (ADR 0015). On 2026-10-30 the product owner asked:

> "we need a way to 're scan' all the previous recordings (one at a time and an option for all at once) to find the notes bc now i have like 10 recordings that have 'no note' when they are clearly different tones"

Analysis is deterministic, so running the same analysis again finds the same thing. The owner chose to improve note finding first, then add Re-scan. The investigation on #282 measured six candidate changes on the 32 Fixture Library Recordings. The orchestrator chose its rank 1 and these rules.

1. **A second pitch window.**
   - When the first 450 ms find no pitch, the same estimate runs once more over the 450 ms that start at the pitch contour's first kept frame. It uses the same voiced frames, energy-weighted median, confidence and 0.2 bar (`estimate_pitch()` in `engine.py`, `estimateAt()` in `recording-pitch.ts`).
   - It never runs for a fart the first 450 ms find a pitch in, so no Melodic Recording changes.
   - The audition and `settle_time()` don't change. A Recording the window finds a pitch in is Melodic only if its read-back is on pitch, as before.
2. **Every browser analyzes every Recording again (`ANALYSIS_VERSION` 5).** On the next open, `upgradeAnalyses` runs the current analysis on each Recording an older one made, one at a time and without a word, as it did for #208.
3. **Re-scan, on the Recordings tab.**
   - A Recording with no note has a "Re-scan" button under its waveform, where an analyzing Recording shows its spinner. The header has "Re-scan all" while any Recording has no note.
   - Re-scan runs the current Recording Analysis again on that Recording's saved audio. Re-scan all does the same for each Recording with no note, one at a time. The status line shows "Re-scanning 2 of 3", and the row being scanned shows a spinner. While one runs, the buttons are off.
   - Then it says what changed: "1 fart now has a note", "2 farts now have a note" or "No new notes", plus ". 1 couldn't be read" when a Recording's audio couldn't be read or its analysis failed. That Recording keeps its analysis.
   - It runs only on analyzed Recordings with no note: Noise-like and not placed (`canRescan` in `analysis-upgrade.ts`). The current analysis already made every other one, so a Re-scan would find what it already has.
4. **A Placed Pitch outlasts a note found later.**
   - When a new analysis, from a Re-scan or the upgrade, finds a Recording Pitch for a placed Recording, the Placed Pitch stays and is the one used. The user chose it by ear, and a new analysis never overrides a user's choice.
   - `songPitch()` is the Placed Pitch first, then the Recording Pitch (`recordings.ts`). Auto-map takes a placed Recording as placed (`autoMapRecordings` in `pitch-coverage.ts`). The reference's `placed()` accepts a Melodic Recording.
   - The row keeps the dashed pill, and "Take it off" gives the fart back the Recording Pitch its analysis found.
   - A placed Recording has a note, so it is never re-scanned. Re-scan's result counts only Recordings that went from no note to a note.
5. **Re-scan doesn't upload, signed in or not.** The new analysis is this browser's copy only, as the upgrade's is.

## Why

**Two fixtures had a tone after the first 450 ms.** Of the eight Noise-like fixtures, the investigation found a measurable tone in two, both after the head. The other six are noise: pYIN voices no frame of any of them inside the gesture, and every one fails the audition even at the best pitch YIN can give it. Only loosening the audition would make them Melodic.

| Recording | Window from | Recording Pitch | Confidence, head → second window | Audition (40-cent bar) | Settles at | YIN over the window |
| --- | --- | --- | --- | --- | --- | --- |
| `009` | 0.290 s | MIDI 30.53, G1 −47 cents | 0.10 → 0.30 | Passes at 0.35 s (+0 cents). 0.12 s reads +2,130 cents, and 0.2 s is unvoiced | 0.493 s | −1 cent |
| `080` | 0.488 s | MIDI 31.33, G1 +33 cents | 0.00 → 0.71 | Passes at 0.6 s (+30 cents). Shorter lengths read 880 to 900 cents off | 0.488 s | −4 cents |

- The other 30 Recordings, all 24 Melodic ones among them, have byte-identical golden analyses (`fixtures/golden/recordings/`).
- Plain autocorrelation reads `009` 236 cents off and `080` 21 cents off. It also reads `094`, a Melodic Recording since #208, 1,583 cents off, so it doesn't separate them.

**Songs still pass the bar (ADR 0012).** The web engine's renders went through `evaluate_renders.py --against-reference`, before (staging at 4b92aa0) and after. On the full Fixture Library only Amazing Grace changes, and every render is byte-identical except it:

| Song | Before | After | Notes within ±50 c of their fart | On time | Second attacks | Median distance from the tune | Same contour | Octave Moves |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Amazing Grace | T −26, `032` on 3 notes | T −28, `080` on 3 notes | 100% → 100% | 100% → 100% | 0 → 0 | 297 → 143 cents | 71% → 93% | 2 → 1 |

- All 13 renders pass, before and after. Each matches the reference's render to within 1.3 × 10⁻⁵ of full scale.
- On the small library (`002 009 016 022 069 090`) Mary Had a Little Lamb unlocks at −35, with `009` on 10 of 26 notes, 100% within ±50 cents of their fart and 96% on time. When the Saints Go Marching In unlocks at −20, with `009` on 4 of 31, 100% and 100%. Every other Song there covers one note more than before, except Row, Row, Row Your Boat, which stays at 5 of 6.
- `run_all.py` on the whole catalog goes from 118 passing, 11 locked and 0 failing to 124, 5 and 0. Old Smoky, Beautiful Dreamer, My Bonnie, My Wild Irish Rose, Pack Up Your Troubles and the New World Largo newly unlock, each at 100% within ±50 cents, 100% on time and no second attacks. Trumpet Voluntary moves from −13 to −28 and reads 98% within ±50 cents, above the 94% bar.

**Re-scan only where there's no note.** Analysis is deterministic, and the upgrade runs the current analysis on every Recording an older one made. So a Re-scan changes only a Recording with no note that the upgrade hasn't reached yet, or that it couldn't read, such as an account Recording whose audio wasn't downloaded. A Re-scan button on a Recording with a note would always say "No new notes".

**No upload.** Each browser makes its own analysis, from the same saved WAV with the same code, so every browser on version 5 finds the same note. The account keeps the analysis a Recording was uploaded with, and a browser that downloads one analyzes it again if an older analysis made it. The sync only changes a Placed Pitch (`library-sync.ts`). Uploading a Re-scan's analysis would need a new account route, and a rule for whose analysis wins when two browsers upload one. The Placed Pitch, the only part a person chooses, already syncs. It now wins over any analysis, so every device of an account shows the same note.

## Options considered

| Option | Why not, or why |
| --- | --- |
| **The second window, only when the first 450 ms find no pitch (chosen)** | Finds `009` and `080`, and changes no Melodic Recording. |
| The second window always | The same two found, but `017`'s Recording Pitch moves from 38.73 to 38.53. |
| Pitch confidence bar 0.2 → 0.1 | A loosening. It finds only `009`, at 29.83 from its weakest frames, on pYIN's floor, and misses `080`. |
| The window with the highest confidence anywhere | Finds only `009`, at 37.13, from its last 0.14 s, a pitch its opening never plays. `080` gets an estimate and fails the audition. |
| pYIN from 30 Hz, not 45 | Finds `080`, but loses `069` and moves 23 Melodic Recording Pitches as pYIN's pitch grid shifts. |
| Drop fewer frames far from the contour's center (6 → 12 semitones) | Finds nothing, and moves 2 Recording Pitches. |
| A Re-scan that replaces a Placed Pitch | The user chose the note by ear. A measurement can't overrule that, and the fart would move under them. |
| Re-scan on every Recording | It would find nothing new on any Recording with a note (see Why). |
| Uploading a Re-scan's analysis | See Why: it needs a new account route and a rule for whose upload wins, and every browser makes the same analysis anyway. |
| Saying what the open's upgrade found | Not done. The rows show the new notes, and the upgrade stays as quiet as #208's. |

## Consequences

- **The new notes are low.** Both are G1, about 49 Hz. That is below the picker's C2 and below every other Melodic fixture (D♯2 and up), so Songs reach them only at deep transpositions. A phone speaker plays little at 49 Hz, so there they sound mostly as harmonics. No one has listened to them yet.
- **They settle late, at about 0.49 s.** The renderer plays from the gesture start, so a short note on either plays mostly the noisy opening. Their shortest notes (0.35 s and 0.6 s) and the settle cost already make Auto-map give them long notes.
- **`080` passes the audition by 10 cents.** It reads +30 cents at 0.6 s, its only passing length, against the 40-cent bar. It is the only Melodic fixture within 20 cents of the bar.
- **The owner's farts weren't measured.** The fixtures show two ways to have no note: a tone after the first 450 ms, which this fixes, and noise, which it doesn't. The owner's ~10 "clearly different tones" came through a phone microphone, which plays little below about 100 Hz, where both fixed fixtures are. This may fix none of them, or most. They go into the Fixture Library when they arrive.
- `fixtures/golden/` changes: `recordings/009` and `080`, `full/amazing`, all 13 small-library Arrangements, `coverage.json` and `index.json`. Its format stays 7.
- **Swift doesn't have this.** The iPhone app is frozen (ADR 0007), and its golden format doesn't change.
- ADR 0015's "If it finds the fart Melodic, its Recording Pitch is used and the placement is ignored" no longer holds (rule 4 above). ADR 0015 has a dated note.
