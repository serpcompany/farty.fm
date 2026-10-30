# Songs play the whole fart

Until #276, Recording Analysis cut each Recording to a "single clean gesture" (ADR 0002): from the attack to the first slow re-attack (#34), or to where the level falls 30 dB below the peak. Songs played only that gesture. The Recordings tab replayed only that gesture too (`replaySegment`), and said "First fart used" and "We kept the first fart" when a second burst was cut off. On 2026-10-30 the product owner said:

> "don't do auto cropping on the original recording. it's messing up the actual recordings"

They chose this outcome the same day:

1. **The Recordings tab plays the whole take.** Every Recording plays start to end, as recorded, and its waveform shows the whole file. The saved file was already the whole take, and it stays that way.
2. **Songs play every burst.** In Songs a fart is never cut short at a second burst. It starts at its attack (decision 4), so a quieter lead-in is trimmed with the silence before it (#287). A Recording with several bursts plays them all, up to the note's end. The renderer's per-note cut, fade, gain and 25 ms gap stay as ADR 0012 set them. The gesture now runs from the attack to the fade-out: it ends after the last 50 ms level within 30 dB of the peak.
3. **The pitch is read from the first burst.** Recording Analysis keeps two extents. The *pitch body* runs from the attack to the first slow re-attack (today's cut, `pitch_end`). The pitch contour, Recording Pitch, audition and settle time read only the pitch body. The *gesture* is what Songs play, and what the length rule (ADR 0011) and Auto-map measure. `rms_db` is the whole gesture's.
4. **The attack still starts the fart.** The start stays the first 5 ms frame within 12 dB of the peak, less 8 ms. The start is not moved back to the first sound above the silence (see Why).
5. **The bar counts only re-attacks the renderer adds.** ADR 0012's "no second attack inside a note" now means a second attack that the note's own fart doesn't have. `evaluate.py` finds every re-attack in a note's render and every re-attack in the dry stretch of the note's own fart, and counts the note (`notes_with_retrigger`) when any re-attack in the render has none in the dry stretch within 30 ms of it (`REATTACK_MATCH_S`, `added_reattacks()`). So a fart re-triggered after its own second burst still counts. A new count, `notes_with_second_burst`, reports the notes whose fart plays a second burst of its own.

`note_segment()` in `tools/melody-lab/engine.py` defines both extents, and `apps/web/src/lib/analysis/trimming.ts` matches it (`Gesture.end` and `Gesture.pitchEnd`).

## Why

### Two extents, not one

Reading the pitch from the whole gesture (option A) and from the first burst only (option B) give the same result on the Fixture Library. They differ on takes with two farts in them.

- **On the 32 fixtures, both give the same answer.** With option A the Melodic set, every Recording Pitch, shortest note and settle time are the same as option B's. Only two confidences drop: `084` from 0.65 to 0.56, and `091` from 0.90 to 0.85.
- **On 80 two-fart takes, option A breaks.** Each take joins two real Melodic fixtures with a 120 ms gap, at equal or double level. Option A turns 29 of the 76 Melodic takes Noise-like and 3 the other way. It moves 2 Recording Pitches by more than 50 cents and changes 33 shortest notes.

So the pitch is read from the first burst (option B). Every pitch body on the Fixture Library is, sample for sample, the gesture before this change, so every Recording Pitch, shortest note and settle time stays the same.

### The start stays at the attack

The owner asked that only silence be trimmed. Some fixtures start with a quiet lead-in before the attack, more than 12 dB below the peak but within 30 dB of it: `022` holds 0.63 s of it, `013` 0.31 s and `009` 0.22 s. Starting the gesture at the first sound instead was measured, at the first level within 30 dB of the peak, in 5 ms or 50 ms frames, less 8 ms:

| Start rule | Unlocked Songs whose onsets fail the bar | Onsets on time, mean | Melodic fixtures |
| --- | --- | --- | --- |
| Attack: first 5 ms frame within 12 dB of the peak, less 8 ms (kept) | 0 of 118 | 100% | 24 |
| First sound, 5 ms frames | 79 of 121 | 85.5% | 22: `013` and `022` turn Noise-like |
| First sound, 50 ms frames | 70 of 121 | 87.8% | 22: the same |

A lead-in played on the beat puts the attack late, so most Songs would fail ADR 0012's timing bar. Reading the pitch from the lead-in also turns `013` and `022` Noise-like. The attack-based start stays.

`009`, which the #282 scout flagged, starts at 0.217 s either way. Its clear G3 opening, at 0.03 to 0.16 s, comes before that, so it is still trimmed in Songs. It plays on the Recordings tab, which now plays the whole take. `009` is Noise-like under every start rule tried, so it plays in Songs only when placed by ear (ADR 0015). Its gesture grows from 0.98 to 1.37 s.

Playing a lead-in before the beat, so that the attack still lands on it, would keep the whole sound. That is a renderer change, and this ADR doesn't make it.

### The bar

Under ADR 0012's bar, which counts every re-attack heard in a note, playing every burst fails 102 of the 118 unlocked Songs. Each failure is a fart's own second burst, which the owner now wants played. The new bar still catches what it was for: a re-attack the renderer makes, such as a fart re-triggered inside a note, before or after the fart's own second burst (`test_reattack.py`). No unlocked Song has one.

### What moves on the Fixture Library

Ten fixtures hold a second burst, and each now plays longer:

| Fixture | Before (first burst) | After (whole fart) |
| --- | --- | --- |
| `002` | 1.80 s | 4.04 s |
| `080` | 1.98 s | 2.49 s |
| `084` | 0.64 s | 1.97 s |
| `032` | 0.93 s | 1.69 s |
| `065` | 0.25 s | 1.49 s |
| `009` | 0.98 s | 1.37 s |
| `059` | 0.79 s | 1.33 s |
| `067` | 0.20 s | 1.30 s |
| `091` | 0.38 s | 0.89 s |
| `052` | 0.30 s | 0.56 s |

`009`, `052`, `065`, `067` and `080` are Noise-like, so their lengths matter only once one is placed by ear.

`run_all.py` on the reference, every catalog Song with the full Fixture Library, under each change's own bar:

| | Songs pass | Songs locked | Songs below the bar |
| --- | --- | --- | --- |
| Before | 86 | 43 | 0 |
| After | 118 | 11 | 0 |

32 Songs unlock and none lock. 4 are app Songs: Jingle Bells, Row, Row, Row Your Boat, Amazing Grace and Auld Lang Syne. So the app unlocks all 12 of its Songs with the Fixture Library, against 8. On the 86 Songs unlocked both before and after, every one reads 100% fidelity and 100% onsets on time, with no re-attack the renderer adds. The typical distance from the tune falls from 160 to 116 cents, averaged over the Songs. The contour score stays at 79%. The share of each note that sounds falls from 96.3% to 94.6% on average, and no note is mostly silent.

Each app Song on the reference with the full Fixture Library. Fidelity, onsets on time and added re-attacks are 100%, 100% and 0 on every unlocked Song in both columns.

| Song | Before: transposition | Before: typical distance | Before: contour | After: transposition | After: typical distance | After: contour | After: notes playing a second burst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Twinkle, Twinkle, Little Star | −20 | 203 cents | 80% | −17 | 220 cents | 53% | 7 of 28 |
| Mary Had a Little Lamb | −36 | 123 cents | 53% | −20 | 87 cents | 100% | 3 of 26 |
| Jingle Bells | locked | | | −19 | 140 cents | 80% | 0 of 26 |
| Frère Jacques | −14 | 120 cents | 85% | −3 | 163 cents | 74% | 8 of 32 |
| When the Saints Go Marching In | −14 | 287 cents | 81% | −11 | 27 cents | 96% | 3 of 31 |
| Row, Row, Row Your Boat | locked | | | −20 | 217 cents | 93% | 1 of 27 |
| Ode to Joy | −31 | 147 cents | 40% | −14 | 118 cents | 75% | 11 of 30 |
| Amazing Grace | locked | | | −26 | 297 cents | 71% | 4 of 16 |
| Für Elise | −28 | 120 cents | 86% | −17 | 177 cents | 31% | 3 of 32 |
| Auld Lang Syne | locked | | | −19 | 137 cents | 64% | 5 of 29 |
| Happy Birthday | −14 | 217 cents | 55% | −4 | 193 cents | 80% | 4 of 25 |
| We Wish You a Merry Christmas | −23 | 53 cents | 88% | −13 | 188 cents | 72% | 2 of 36 |

The web engine's renders of the 13 golden Songs (`render-songs.ts`, then `evaluate_renders.py --against-reference`) all pass, and the largest sample difference from the reference's render is −98 dBFS.

## Consequences

- **Every take plays as recorded on the Recordings tab.** `replaySegment` and `firstFartUsed` are gone from the web app, and so are "First fart used" on a Recording's row, "We kept the first fart" on the Result and the support page's entry about it.
- **Unlocking is easier.** With the Fixture Library, the first Songs unlock at the 9th take of the story in `pitch-coverage.test.ts` (6 Songs, against 3), and 11 by the 11th (against 7). Amazing Grace still needs a 3 s fart near A♯3 there. On the full library nothing is left for Recording `080` placed on C2 to unlock. Without `002` it unlocks Jingle Bells and Auld Lang Syne.
- **Fart lengths on screen grow.** The Recordings tab and Song Creator show the gesture's length (ADR 0011, #227), which now counts every burst. `084` shows 1.9 s, not 0.6 s.
- **Stored Recordings are analyzed again.** `ANALYSIS_VERSION` is 4, so `upgradeAnalyses` re-analyzes each stored Recording on the next open. The stored Analysis keeps its fields. `gestureStartSeconds` and `gestureEndSeconds` are the whole fart. `cutAtReattack` now means the pitch was read from the first burst only. The pitch body's end isn't stored, since nothing after analysis reads it.
- **The golden data is format 7:** `gesture.end_*` is the whole fart, `gesture.pitch_end_sample` and `pitch_end_s` are the pitch body's end, and each Arrangement's metrics add `notes_with_second_burst`. Swift stays frozen at format 2 (`RecordingAnalysisKit/Tests/GoldenFormat2/`) and isn't changed: the iPhone app still plays and shows the first burst only.
- **A quiet lead-in before the attack is still trimmed in Songs** (`009`'s G3 opening). Keeping it means playing it before the beat, which is a renderer change for another issue.
- ADR 0002, ADR 0011 and ADR 0012 carry dated notes where this changes them.
