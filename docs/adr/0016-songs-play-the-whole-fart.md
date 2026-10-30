# Songs play the whole fart

Until #276, Recording Analysis cut each Recording to a "single clean gesture" (ADR 0002): from the attack to the first slow re-attack (#34), or to where the level falls 30 dB below the peak. Songs played only that gesture. The Recordings tab replayed only that gesture too (`replaySegment`), and said "First fart used" and "We kept the first fart" when a second burst was cut off. On 2026-10-30 the product owner said:

> "don't do auto cropping on the original recording. it's messing up the actual recordings"

They chose this outcome the same day:

1. **The Recordings tab plays the whole take.** Every Recording plays start to end, as recorded, and its waveform shows the whole file. The saved file was already the whole take, and it stays that way.

   Update 2026-10-30 (ADR 0019, #293): a Noise-like Recording the user trimmed plays and draws only what's between its Trim's handles on its row and in the picker, and Songs play the fart found between them. It is the one exception. The saved file is still the whole take, and Remove trim brings it all back.
2. **Songs play every burst.** In Songs a fart is never cut short at a second burst. It starts at its attack (decision 4), so a quieter lead-in is trimmed with the silence before it (#287). (Update 2026-10-30, #287: the lead-in now plays just before the note's beat, in the rest before the note, so the attack still lands on the beat. See the update at the end.) A Recording with several bursts plays them all, up to the note's end. The renderer's per-note cut, fade, gain and 25 ms gap stay as ADR 0012 set them. The gesture now runs from the attack to the fade-out: it ends after the last 50 ms level within 30 dB of the peak.
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

`009`, which the #282 scout flagged, starts at 0.217 s either way. Its clear G3 opening, at 0.03 to 0.16 s, comes before that, so it is still trimmed in Songs (until #287, in the update at the end). It plays on the Recordings tab, which now plays the whole take. `009` is Noise-like under every start rule tried, so it plays in Songs only when placed by ear (ADR 0015). Its gesture grows from 0.98 to 1.37 s.

Playing a lead-in before the beat, so that the attack still lands on it, would keep the whole sound. That is a renderer change, and this ADR doesn't make it. #287 makes it, on 2026-10-30 (the update at the end).

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
- **A quiet lead-in before the attack is still trimmed in Songs** (`009`'s G3 opening). Keeping it means playing it before the beat, which is a renderer change for another issue. Update 2026-10-30: #287 plays it before the beat, in the rest before the note (below).
- ADR 0002, ADR 0011 and ADR 0012 carry dated notes where this changes them.

## Update 2026-10-30: the lead-in plays before the beat (#287)

The renderer now plays a fart's quiet lead-in just before its note's beat, so the attack still lands on the beat. The lead-in is the quiet sound joined to the fart's attack. From the attack's 5 ms frame, it walks back over every frame within 30 dB of the peak, and over quieter gaps of up to 50 ms. It starts 8 ms before the earliest such frame and is at most 0.25 s long. This uses the same 30 dB that ends the gesture, and the same frames and 8 ms that start it (`lead_in_start()` in `engine.py`, `leadInStart()` in `apps/web/src/lib/engine/render-source.ts`). The longest lead-ins on the Fixture Library are `013`'s and `022`'s 0.25 s (their quiet sound before the attack lasts 0.31 s and 0.63 s), `009`'s 0.21 s, `032`'s and `084`'s 0.10 s and `098`'s 0.05 s. Every other fixture's is 0.015 s or less. [Room noise](#room-noise) has why the lead-in has to be joined to the attack and why it's capped.

This is placement and mixing only. Recording Analysis doesn't change: the gesture, the pitch body, audition, settle time and Auto-map stay as they are. The web renderer finds the lead-in in the saved audio each time it renders, so the stored Analysis keeps its fields and `ANALYSIS_VERSION` doesn't change. A note's level is still set from its attack: read from the start of a quiet lead-in, it would come out far too loud.

Two decisions, measured on the reference:

1. **A Song's first note cuts its lead-in at the Song's start.** There is no pre-roll. The playhead, and a note tapped on the Result, which plays its own slot of the Toot's audio, take the Song's first beat as the start of the audio, and a Toot stores only its audio. A pre-roll would need an offset stored and read everywhere a Toot plays. It would add 5.34 s of lead-in over 78 of the 118 unlocked catalog Songs, at most 0.25 s each.
2. **The lead-in plays only in a rest.** It reaches back no earlier than where the notes before it end as written or stop playing. So it never fills the 25 ms gap after a note, and it's never mixed over another fart.

The rules tried for decision 2. The catalog is the 118 unlocked catalog Songs on the full Fixture Library. The 7 libraries are the Fixture Library with `009` placed on G3, less the Recordings that would take its notes, such as When the Saints without `002`, `032` and `022`.

| Where the lead-in may start | Catalog Songs below the bar | Onsets on time, worst Song | Notes playing a lead-in | Lead-in played | Libraries with `009` placed below the bar |
| --- | --- | --- | --- | --- | --- |
| No lead-in (before) | 0 | 100% | 0 | 0 s | 0 of 7 |
| Wherever it reaches, mixed over the note before | 22: 21 add a re-attack, 1 below fidelity | | | | |
| Where the note before stops playing, filling the gap | 0 | 98% (`minuet-in-g`) | 2,893 | 40.66 s | 5 of 7, at 88 to 94% on time |
| Where the note before ends as written (kept) | 0 | 100% | 89 of 3,697, in 38 Songs | 4.07 s | 0 of 7, at 97 to 100% on time |

Filling the gap fails because `009`'s attack is a soft rumble. The onset detector finds it by the silent gap before it. With 25 ms of lead-in in the gap, the nearest onset to `009`'s beat falls 175 to 451 ms late. In a rest, `009` keeps its G3 opening. In When the Saints without `002`, `032` and `022`, `009` placed on G3 plays the first note, on the half beat at 0.2 s. So 0.2 s of its 0.21 s G3 opening plays before the beat, and the Song passes the bar with 97% of onsets on time. `test_lead_in.py` and `renderer.test.ts` check this case.

### Room noise

The first version of this rule took the lead-in from the first 5 ms frame within 30 dB of the peak, anywhere before the attack. The owner's 6 phone takes (fixtures `105` to `110`, #295) showed that this plays room noise. Each take holds 1 to 2.7 s of room before the fart, mostly more than 30 dB under its peak, with a few louder bumps. The first bump within 30 dB started the lead-in, so `106` would have played 1.98 s of room noise before its beat.

Three rules were measured on the Fixture Library and the 6 takes. The table gives each lead-in in seconds. "Others" is the other 32 takes, compared with the first version.

| Lead-in | `009` | `013` | `022` | `106` | `107` | `108` | `109` | Others |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| First frame within 30 dB (the first version) | 0.215 | 0.306 | 0.631 | 1.976 | 1.142 | 0.539 | 0.594 | |
| Also 10 dB above the take's noise floor (its 10th-percentile frame) | 0.025 | 0 | 0 | 1.976 | 1.142 | 0.539 | 0.594 | |
| Capped at 0.25 s | 0.215 | 0.25 | 0.25 | 0.25 | 0.25 | 0.25 | 0.25 | the same |
| Joined to the attack, gaps up to 50 ms | 0.215 | 0.306 | 0.631 | 0.005 | 0.010 | 0 | 0 | the same |
| Joined to the attack, and capped at 0.25 s (kept) | 0.215 | 0.25 | 0.25 | 0.005 | 0.010 | 0 | 0 | the same |

- **Measuring against the noise floor fails both ways.** `009`'s G3 opening is its own quietest stretch: its 10th-percentile frame is 23 dB under its peak, and the opening runs 13 to 29 dB under. A margin of 6 to 15 dB above that floor cuts the opening to 0.08 s or less. `106`'s floor is 40 dB under its peak, so its noise bumps clear every margin up to 15 dB, and it still plays 1.6 s or more.
- **A cap alone still plays noise.** On `106` to `109` it plays the last 0.25 s before the attack, and that stretch is all room noise, below the 30 dB line.
- **Joining the lead-in to the attack separates the two.** A real lead-in runs into its attack. `009`'s opening, and `013`'s, `022`'s and `084`'s quiet sound, have no gap longer than 25 ms. Just before the attack of each of `106` to `109`, at least 0.25 s of room sits below the 30 dB line. Every gap limit from 25 to 200 ms gives the same lead-ins, to the millisecond, on all 38 takes. A limit of 0 ms cuts `084`'s 0.10 s to 0.015 s, so 50 ms sits safely inside that range.
- **The cap is for a noisier room.** With `106`'s room noise raised 6 dB, the noise joins the attack and plays 0.30 s. Raised 10 dB, it plays 2.2 s. The cap keeps that to 0.25 s, which still holds `009`'s 0.215 s opening whole. It shortens only `013` and `022`, whose quiet sound sits at their own noise floor: pYIN finds a pitch in 0% and 9% of its frames, against 100% of `009`'s opening.

The change from the first version moved no Song's results. `run_all.py` prints the same line for all 129 Songs. In the golden data only `013`'s and `022`'s `lead_start_sample` change, and no golden note's `lead_s` does. The 7 libraries with `009` placed give the same results. Over the catalog, the lead-ins played go from 4.56 s to 4.07 s, still on 89 notes.

Before and after, the reference's `run_all.py` reports the same results on the catalog's 129 Songs. 118 pass, 11 are locked and none is below the bar. Every unlocked Song has 100% fidelity and 100% of its onsets on time, and no Song has a re-attack the renderer adds. Only `silvery-moon`'s sounding share moves, from 95% to 96%. Of the 13 golden Songs, only one note plays a lead-in: note 24 of When the Saints, after a 0.6 s rest, plays 2 ms of `101`'s lead-in. Every golden metric stays the same. Each of the web engine's 13 golden renders passes, before and after. Every note's heard and fart cents equal golden, and the largest sample difference from the reference's render is −98.0 dBFS.

The numbers above were measured before #295 merged. #295 adds the owner's 6 takes to the Fixture Library and a second pitch window, which makes `009` Melodic. Measured again after it, the catalog has 124 unlocked Songs and 5 locked ones. Before and after the lead-in, all 124 pass, with 100% of onsets on time, and again only `silvery-moon`'s sounding share moves. 92 of 3,812 notes play a lead-in, in 40 Songs, 4.09 s in all. A pre-roll would add 5.40 s over 83 Songs. The owner's takes get lead-ins of 0.010 s or less (`105` 0.005 s, `106` 0.005 s, `107` 0.010 s, `108` to `110` none), and `009` keeps its 0.215 s. The 13 golden renders still pass, at −98.0 dBFS at most.

Consequences:

- **Most notes play as before.** Auto-map picks a fart at least as long as its pitch's longest note (ADR 0011), so legato notes leave only the gap and play no lead-in. A lead-in plays after a rest, or before a first note that doesn't start the Song. `009`'s G3 opening needs about 0.2 s of rest before its note. The app's Songs give that room only on When the Saints' first note (0.2 s), its note 24 (a 0.6 s rest) and Auld Lang Syne's first note (0.6 s).
- **A tapped note plays its written slot.** On the Result, a tapped note plays from its beat, so it doesn't play its own lead-in. Because a lead-in plays only in a rest, a slot never holds the next note's lead-in.
- **The golden data is format 8.** `gesture.lead_start_sample` and `lead_start_s` give where the lead-in starts, and each note's `render.lead_s` gives the lead-in played. The render's `start_s` is still the beat, and `len_s` is the fart played from there.
- ADR 0012 carries a dated note.
