# Length: a Song unlocks only with farts as long as its notes

Until #221, unlocking checked pitch only. A note's length was only a cost (the settle and silence costs, #92 and #205), and rendering never stretches, loops or re-triggers a Recording (ADR 0004). So a short fart could unlock a Song and then play a long note, leaving the rest of the note silent. With the Fixture Library before #219, 45 of the 356 notes in the 12 app Songs were less than 80% filled by their fart: Happy Birthday played its 1.18 s half note with a 0.43 s fart. On 2026-10-28 the product owner decided that unlocking has to take each note's length into account, and the same day ruled out stretching farts to fit.

1. **The length rule.** A Melodic Recording covers a Song pitch only if it is near enough in pitch (ADR 0004 and ADR 0006) and, once resampled to that pitch, lasts at least `NOTE_FILL` × the longest note at that pitch:

   `seconds × 2^(−shift / 12) ≥ NOTE_FILL × max(dur × 60 / bpm − GAP_S)`

   `seconds` is the Recording's trimmed gesture. A note's slot is its written length less the 25 ms gap. An Octave Move up halves the Recording's length, and one down doubles it. Pitch Coverage, the Arrangement and the unlock all use this rule. The costs, the ranking (coverage, then Octave Moves, then cost) and the tie-break are unchanged, so Auto-map chooses long-enough Recordings through its transposition search.
2. **`NOTE_FILL` is 1.0:** a fart must last as long as the note. The measurements below decided this.
3. **A missing note says how long a fart it needs:** `NOTE_FILL` × the pitch's longest note, rounded up to 0.1 s, as in "Needs a fart near D♯3 (3.0 s)". The length is for a fart at the note's own pitch: a fart an octave higher needs half as long, since moving it down doubles it, and one an octave lower needs twice as long. Only a locked Song's sheet and its Compose row show it. Record has no new prompts.
4. **Recordings are never stretched or looped to fit.** The owner ruled that out, and ADR 0004 is unchanged: rendering still only trims, resamples, fades, adjusts gain and mixes. A Song's tempo doesn't change to fit either.

Update 2026-10-28 (ADR 0012, #226): Songs play every fart raw, so the rule uses the fart's own length, `seconds ≥ NOTE_FILL × max(dur × 60 / bpm − GAP_S)`. An Octave Move no longer halves or doubles it, and the length in 3 is the same whatever the fart's octave. The costs use the fart's own length too. With the Fixture Library this locks Jingle Bells, Row, Row, Row Your Boat and Auld Lang Syne, and 35 other catalog Songs. The measurements below used lengths after resampling.

Update 2026-10-28 (#227): the Recordings screen and Song Creator show each Recording's fart length, the gesture this rule measures, not the whole take. They round it down to 0.1 s, as the length in 3 is rounded up, so a fart shown as long as a missing note says is long enough for it.

Update 2026-10-30 (ADR 0016, #276): the gesture is now the whole fart, every burst kept, so ten fixtures last longer (`002` 1.80 to 4.04 s, `084` 0.64 to 1.97 s). With the Fixture Library 32 more catalog Songs unlock, among them the 4 app Songs that were locked, so all 12 app Songs unlock. The Recordings screen still shows the gesture's length, now with every burst.

The reference engine (`fills()` and `needed_seconds()` in `tools/melody-lab/engine.py`) defines the rule, and Auto-map in `apps/web/src/lib/engine/auto-map.ts` matches it. `fixtures/golden/` (format 4) records each locked Song's `missing` notes with their lengths.

## Why

#221 asked for 0.9 unless 0.9 broke ADR 0004's bar on an unlocked app Song. It does, on Für Elise. 0.75, 0.9 and 1.0 were swept on the reference with the full Fixture Library (32 Recordings), each unlocked Song rendered and read back with `evaluate.py`. "At the bar" means ADR 0004's checks: at least 94% of notes within ±50 cents, onsets on time, and no second attack inside a note. "Sounding" is the share of each note's slot that sounds. A note is "mostly silent" when less than half of its slot sounds. The app columns count notes only in the 11 app Songs that unlock at every fill (340 notes), so the rows compare like with like. The catalog counts all 129 catalog Songs, the app's among them.

| `NOTE_FILL` | App Songs unlocked | App Songs at the bar | App sounding | App notes mostly silent | App notes under 80% filled | Catalog unlocked | Catalog at the bar | Catalog sounding | Catalog notes mostly silent |
|---|---|---|---|---|---|---|---|---|---|
| none (before) | 12 of 12 | 12 of 12 | 91.5% | 6 of 340 | 26 of 340 | 129 of 129 | 128 of 129 | 90.7% | 101 of 3,913 |
| 0.75 | 12 of 12 | 10 of 12 | 94.2% | 0 | 8 | 127 of 129 | 118 of 127 | 94.3% | 0 of 3,883 |
| 0.9 | 11 of 12 | 10 of 11 | 95.8% | 0 | 0 | 126 of 129 | 113 of 126 | 95.4% | 0 of 3,867 |
| **1.0 (chosen)** | 11 of 12 | **11 of 11** | **96.1%** | 0 | 0 | 123 of 129 | 106 of 123 | 95.9% | 0 of 3,795 |

- **0.9 breaks Für Elise.** Its score pitch 71 (B4) plays as G2 at T=−28, and its longest note there is 1.066 s. From 0.75 up the rule takes that pitch from `019` (0.33 s) to `069` (1.08 s, 1.17 s moved to G2). The attack of `069` reads +243 cents on the pitch's 0.25 s notes, and the Song reads 91% within 50 cents. At 1.0 `069` still fills G2. What changes is score pitch 69 (A4, played as F2): its 1.339 s note is too long for `022` (1.37 s, 1.32 s moved to F2), so that pitch takes `032` with an Octave Move down. That frees `022` for G2, where it beats `069` on cost (23 against 215), and the Song reads 100%. So Für Elise passes at 1.0 through the cost ranking, not because the rule excludes `069`. A small change to the library or the costs could bring `069` back on that pitch.
- **0.75 breaks Amazing Grace too.** It unlocks with three Octave Moves and reads 88%, with a second attack inside a note.
- **1.0 locks nothing in the app that 0.9 unlocks.** Amazing Grace locks at both: its 2.98 s note is longer than any Recording lasts, even moved down an octave. It needs a D♯3 fart of 3.0 s.
- **Every fill ends the mostly silent notes,** and 1.0 fills the most: app Songs sound 96.1% of the time against 91.5% before.

`run_all.py` before and after on the reference, with the app's 12 Songs counted apart from the 116 other catalog Songs:

| | App Songs unlocked | App at the bar | App sounding | App notes mostly silent | Other catalog unlocked | Other catalog at the bar | Other catalog sounding | Other catalog notes mostly silent |
|---|---|---|---|---|---|---|---|---|
| Before | 12 of 12 | 12 of 12 | 91.5% | 7 of 356 | 116 of 116 | 115 of 116 | 90.7% | 93 of 3,527 |
| After | 11 of 12 | 11 of 11 | 96.0% | 0 of 340 | 111 of 116 | 94 of 111 | 95.8% | 0 of 3,425 |

## Consequences

- **Amazing Grace is locked** on the Fixture Library ("Needs a fart near D♯3 (3.0 s)"). It unlocks once someone records a fart long enough for its longest note.
- **Five other catalog Songs lock:** `red-river-valley`, `joy-to-the-world`, `daisy-bell` and `johnny-comes-marching` each need one long note, and `taps` needs two farts of 5.0 s.
- **More catalog Songs fall below ADR 0004's bar.** None of them is in the app yet. Of the 111 other catalog Songs that still unlock, 94 pass, against 115 of 116 before. With so few long Recordings in the Fixture Library, the rule leans on the longer ones. Off-pitch notes rose from 3 of 3,527 to 107 of 3,425. 45 of them are on `069`, the Recording that took Für Elise below the bar at 0.9. 35 are on Octave Moves down, which double a Recording's length: 280 notes use them now, against none before. `trumpet-voluntary` reads 44% and `my-wild-irish-rose` 61%. Before the app adds catalog Songs, Auto-map's costs need to steer around this, or those Songs wait for longer farts.
- **A new user's first farts unlock fewer Songs.** On the small library (`002 009 016 022 069 090`), only Mary unlocks, against five Songs before. All five played notes of 0.64 to 1.18 s with `016`, which lasts 0.31 s.
- **Two Für Elise notes are close to the bar.** Notes 13 and 31 read −47 cents: 0.25 s on `032`, moved down an octave. The Song still reads 100%.
- **The text names a length.** "Needs a fart near D3 (0.5 s) and F3 (1.2 s)." on a locked Song's sheet. On Compose a locked Song's row names at most two notes, so the line still fits on a phone.
- If real users' farts are mostly short, revisit 2. The sweep table shows what a lower `NOTE_FILL` costs.
