# Songs play farts raw

Until #226 every note resampled its fart to the note's pitch and held it there, following the fart's own pitch contour (ADR 0004). Toots read in tune: every unlocked app Song had 100% of its notes within ±50 cents of the melody. On 2026-10-28 the product owner heard every unlocked app Song rendered three ways: with today's pitch hold, with one fixed shift that keeps the fart's slide, and raw. They chose raw:

> "RaW is the best its the funniest. it doesnt have to sound exaclty like the song as long as the listener gets the idea which they wil"

1. **No pitch change.** Every note plays its fart as recorded, at the fart's own pitch and speed. Rendering trims the dead space before and after the fart, cuts it at the note's end (its written length less the 25 ms gap), fades it, sets its level and mixes. It never resamples a fart to change its pitch or its length, so a Song is played by farts as they are.
2. **Auto-map keeps its rules.** Pitch Coverage, the unlock rule's pitch part and the ranking are unchanged. The costs keep their form but now use the fart's own length (point 3). A fart still covers a note within 3 semitones of its Recording Pitch, or within 3 semitones of the same note an octave away (an Octave Move, ADR 0006). An Octave Move now plays its fart an octave from the note, give or take 3 semitones.
3. **Length is the fart's own.** The length rule (ADR 0011) and Auto-map's costs use the fart's own length. They used its length after resampling, `seconds × 2^(−shift / 12)`, so an Octave Move down doubled a fart's length and one up halved it.
4. **The bar** that a render must pass changes. ADR 0004's "notes within ±50 cents of the note" can't hold when farts play raw. The new bar:
   - **Fidelity:** at least 94% of notes sound within ±50 cents of their fart's own pitch over the stretch played (`within_50c_of_fart_pct`). A render that moves a fart's pitch more than 50 cents on more than 6% of its notes fails it.
   - **Timing:** at least 95% of onsets within ±50 ms, and no second attack inside a note. Unchanged.
   - **Reported, not gated:** per Song, the typical distance from the melody (`median_abs_cents`, pYIN's per-note median) and a contour score (`contour_pct`): the share of the melody's note-to-note steps that the render moves the same way.

Update 2026-10-30 (ADR 0016, #276): rendering trims only the silence around a fart. It no longer cuts a fart at its second burst: every burst plays, up to the note's end. "No second attack inside a note" now means one the note's own fart doesn't have: `evaluate.py` leaves out a re-attack within 30 ms of one in the dry stretch the note plays. Every app Song unlocks with the Fixture Library, and every unlocked catalog Song still passes the bar.

Update 2026-10-30 (#287): a fart's quiet lead-in, the sound joined to its attack and at most 0.25 s long, plays just before the note's beat when the rest before the note has room, so the attack still lands on the beat. It never fills the 25 ms gap after a note, is never mixed over another fart and is cut at the Song's start. Rendering still only trims, cuts, fades, sets the level from the attack and mixes, at the fart's own pitch and speed. Every unlocked catalog Song still passes the bar with every onset on time. ADR 0016's update has the measurements, including why filling the gap was ruled out.

`render()` and `evaluate.py` in `tools/melody-lab/` define this, and `apps/web/src/lib/engine/` matches them. `evaluate.py` measures fidelity with YIN frame by frame: on each note's loud frames, the pitch it reads in the render less the pitch it reads on the same frame of the dry fart, the stretch the note plays. The note is faithful when the median difference is within ±50 cents. The PDMX import's render gate (`tools/catalog/import_pdmx.py`) uses the same bar.

## Why

What the owner heard: the reference render on the full Fixture Library, with today's picks (the Arrangements on Staging before #226) and each shift set to 0.

| | Today (pitch held) | Raw |
|---|---|---|
| Notes within ±50 cents of the note | 100% on every Song | 0 to 29% |
| Typical distance from the note | 2.6 cents | 103 to 273 cents |
| Notes within ±50 cents of their fart's own pitch | 0 to 25% | 100% on every Song |
| Onsets on time | 100% | 100% |
| Re-attacks | 0 | 0 |

Raw is much further from the melody, and the owner judged it funnier and still recognizable. The new bar checks what raw promises: each fart plays as recorded, on time, with one attack.

Each app Song on the reference with the full Fixture Library: what the owner heard (today's picks, raw), and this decision's render (raw, with picks under the fart's own length). Fidelity, onsets on time and re-attacks are the bar. Every unlocked Song in both columns reads 100%, 100% and 0.

| Song | Heard: within ±50 cents of the melody | Heard: typical distance | Heard: contour | Now: transposition | Now: within ±50 cents of the melody | Now: typical distance | Now: contour | Now: Octave Moves |
|---|---|---|---|---|---|---|---|---|
| Twinkle, Twinkle, Little Star | 29% | 233 cents | 80% | −20 (was −28) | 29% | 203 cents | 80% | 1 |
| Mary Had a Little Lamb | 0% | 117 cents | 65% | −36 (was −34) | 42% | 123 cents | 53% | 1 |
| Jingle Bells | 15% | 223 cents | 80% | locked: needs F♯2 (2.0 s) | | | | |
| Happy Birthday | 0% | 227 cents | 85% | −23 (was −19) | 4% | 213 cents | 50% | 1 |
| Frère Jacques | 6% | 128 cents | 93% | −14 | 12% | 120 cents | 85% | 1 |
| When the Saints Go Marching In | 23% | 123 cents | 81% | −14 (was −23) | 0% | 287 cents | 81% | 0 |
| Row, Row, Row Your Boat | 11% | 193 cents | 80% | locked: needs D♯2 (1.5 s) | | | | |
| Ode to Joy | 3% | 273 cents | 65% | −31 (was −24) | 20% | 147 cents | 40% | 1 |
| We Wish You a Merry Christmas | 19% | 103 cents | 87% | −15 | 23% | 103 cents | 92% | 0 |
| Amazing Grace | locked | | | locked: needs D3 (1.2 s) and F3 (3.0 s) | | | | |
| Für Elise | 25% | 137 cents | 21% | −28 | 25% | 120 cents | 86% | 0 |
| Auld Lang Syne | 24% | 243 cents | 68% | locked: needs G3 (1.8 s) | | | | |

### Picks that changed

Every app Song whose picks changed has at least one pitch whose fart is too short for that pitch's longest note at the fart's own length:

- **Twinkle:** A2 on `096` (0.47 s) for a 0.52 s note, C3 on `032` (0.93 s) for 1.07 s, and D3 on `101` (0.52 s, just under 0.52 s). All 28 notes change fart.
- **Mary:** D2 on `022` (1.37 s) for 1.40 s. 16 of 26 notes change.
- **Happy Birthday:** B2 on `094`, 1.30 s moved down an octave but 0.67 s raw, for 1.18 s, and D3 on `101` (0.52 s) for 0.57 s. 12 of 26 notes change.
- **Frère Jacques:** A2 on `096` (0.47 s) for 0.52 s, and C3 on `032` (0.93 s) for 1.07 s. 16 of 32 notes change.
- **Saints:** C♯2 on `017` (0.90 s) for 0.97 s, and F2 on `019` (0.33 s) for 0.38 s. All 31 notes change.
- **Ode to Joy:** D3 on `101` (0.52 s, just under 0.52 s). All 30 notes change.
- **Merry Christmas:** G♯3 on `091` (0.38 s) for 0.40 s. 6 of 53 notes change.
- **Für Elise:** F2 on `032`, 1.64 s moved down an octave but 0.93 s raw, for 1.34 s. 26 of 32 notes change.
- **Jingle Bells, Row, Row, Row Your Boat and Auld Lang Syne lock:** under every transposition, some pitch has no Melodic fixture long enough within reach. Jingle Bells' 1.98 s G♯2 had `002` (1.80 s, 2.07 s moved down 2.4 semitones), Row's 1.48 s D2 had `022` (1.37 s, 1.57 s moved down 2.3 semitones), and Auld Lang Syne's 1.77 s F3 had `059` (0.79 s, 1.82 s moved down an octave). Two more pitches also fall short: Jingle Bells' B2 on `094` (0.67 s, an Octave Move) for 0.975 s, and Row's D3 on `100` (0.21 s) for 0.225 s.

When one pitch's fart no longer fits, Auto-map searches again, so the transposition and the other pitches' farts can change too.

### The catalog

`run_all.py` on the reference with the full Fixture Library, before (pitch held, ADR 0004's bar) and after (raw, this bar):

| | App Songs pass | App Songs locked | Other catalog Songs pass | Other catalog Songs locked | Other catalog Songs below the bar |
|---|---|---|---|---|---|
| Before | 11 | 1 | 95 | 5 | 17 |
| After | 8 | 4 | 78 | 39 | 0 |

- **No unlocked Song fails the bar.** Every one of the 86 reads 100% fidelity, onsets on time and no re-attacks.
- **8 Songs that failed ADR 0004's bar now pass:** `shenandoah`, `down-by-the-riverside`, `joshua`, `all-through-the-night`, `skye-boat-song`, `santa-lucia`, `eine-kleine` and `scotland-the-brave`. They failed on notes off the melody, which the bar no longer checks.
- **`johnny-comes-marching` unlocks.** It was locked by the length rule.
- **38 Songs lock:** 3 app Songs and 35 other catalog Songs, from `au-clair` to `stars-and-stripes`. 9 of these failed ADR 0004's bar already. Most need a long low fart, which an Octave Move down used to double: `silent-night` needs C2, D♯2 and G2 of 2.0 s and G♯2 of 1.4 s.
- **How close the 86 sound to their tune:** a typical distance of 22 to 913 cents (median 155) and a contour score of 40 to 100% (median 81%).

## Consequences

- **The app unlocks 8 of its 12 Songs with the Fixture Library,** against 11 before. Jingle Bells, Row, Row, Row Your Boat and Auld Lang Syne each need a fart longer than any fixture near one of their pitches, and Amazing Grace now needs two. If the owner would rather keep the farts they heard, the length rule would have to measure a fart after the Octave Move again, though the fart no longer plays that way. The render they heard left some notes partly silent: 93 to 98% of each Song sounds, and one Auld Lang Syne note is mostly silent.
- **Long farts matter more.** Every Song the Fixture Library unlocks plays `002` (1.80 s), the only fixture of at least 1.4 s. No Song unlocks on the small library (`002 009 016 022 069 090`): Mary used `090` (0.48 s) moved down an octave to fill 0.69 s notes. The e2e journeys and the sample story in `pitch-coverage.test.ts` record longer farts.
- **What the app says changed.** Song Creator's note caption drops the shift: "F3 · Recording 21 (G3) · 1.4 s". The lander says each note is a Recording "played just as you made it".
- **Rendering converts a Recording's sample rate only.** A 48 kHz Recording is converted to 44.1 kHz once, as before. That doesn't change its pitch or speed. The web renderer no longer recomputes each Recording's pitch contour to make a Toot.
- **Recording Analysis is unchanged.** Audition and settle time still read each fart back with its pitch held on its Recording Pitch (`variable_resample()` in `engine.py`, `variable-resample.ts` on the web), so the same Recordings are Melodic and the settle cost is the same. Only Recording Analysis uses that read-back now. Reading farts back raw there instead would change which Recordings are Melodic and Auto-map's picks. That would be its own issue.
- **The golden data is format 5:** `fart_cents` per note and `within_50c_of_fart_pct` and `contour_pct` per Arrangement, no `tune`, and the 13 hand-entered Songs only (since #225, the Songs the web app ships plus the hand-entered ones, still 13). Swift stays frozen at format 2 and isn't changed.
- ADR 0004, ADR 0006 and ADR 0011 carry dated notes where this changes them.
