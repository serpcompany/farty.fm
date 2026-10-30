# Noise-like farts are placed by ear

Until #268 no Song used a Noise-like Recording: it sat on the Recordings tab, marked noise-like. Beats (#262, PR #263, written up as ADR 0014) let Songs play these farts as unpitched beats. They were reverted with their ADR (PR #267), so 0014 stays unused. On 2026-10-28 the product owner asked for this instead:

> "for farts it cannot analyze we should allow the user to place it on a midi/piano roll where he thinks it matches the piano note the closest or not use it at all."

They chose design A of three ("letys go with design A"). They also chose the Recordings tab as the place, a piano note to compare with, leaving a fart out by default, and moving or removing a placement later.

Update 2026-10-30 (#282, ADR 0017): a placement outlasts a Recording Pitch that a later analysis finds. The Placed Pitch stays and is the one used, since the user chose it by ear. That replaces rule 6's "If it finds the fart Melodic, its Recording Pitch is used and the placement is ignored". Rule 1 still holds: only a Noise-like Recording can be placed, and a placed one can still be moved or taken off. A second pitch window finds `009` and `080` Melodic, both at G1, below the picker's C2. The measurements below were taken while both were Noise-like. Rule 2's count is now 26 Melodic golden Recordings, from G1 to G4, and the picker stays C2 to B4.

1. **Place it, or leave it out.**
   - On the Recordings tab, a Noise-like Recording's row has an outlined "noise-like ›" pill. It opens the picker (`place-by-ear.tsx`): a stock bottom Sheet on a phone, a centered Dialog from 48rem wide.
   - The picker has the fart's play button, waveform and length, one octave of piano keys with octave arrows, then "Place at E3" and "Leave it out".
   - A placed fart's row shows its note in a dashed pill, with "Placed by ear" under its name. Tapping the pill opens the picker again, to "Move to" another note or "Take it off".
   - Leaving a fart out is the default, and a fart left out behaves as before #268.
   - Only a Noise-like Recording can be placed. A Melodic Recording keeps the Recording Pitch its analysis found.
2. **C2 to B4, opening on octave 3.**
   - Recording Analysis listens from 45 to 900 Hz (F♯1 to A5, `pyin.ts`). C2 to B4 are the three whole octaves inside that, so every key is a note an analyzed fart could also land on.
   - The 24 Melodic golden Recordings fall between D♯2 and G4: 12 in octave 2, 11 in octave 3 and 1 in octave 4. So the picker opens on octave 3, or on the octave of the fart's current note.
3. **The piano sounds only in the picker.**
   - Tapping a key plays a short piano-like note to compare with the fart (`playPianoNote` in `piano-keys.tsx`). It is built with Web Audio from six decaying partials under a closing low-pass filter.
   - The note never reaches a Song, a Toot or a render. The renderer and Song Creator don't import it, so Songs stay fart-only (ADR 0004).
4. **A Placed Recording is a Melodic Recording at its Placed Pitch.**
   - This holds for Pitch Coverage, Auto-map, the Recordings tab's count, Song Creator and a Toot's note captions (`songPitch()` in `recordings.ts`).
   - It plays raw (ADR 0012): the note says only which notes of a Song it plays, never how it sounds. No copy says it is tuned.
   - The renderer's Melodic-only guard (`render-source.ts`) is removed, not loosened: `renderSource` cuts any Recording's gesture, placed or not. Auto-map alone decides which farts play. That is safe because only the Recordings an Arrangement uses are rendered (`makeToot` in `toot-renderer.ts`), and Auto-map reads only analyzed Melodic Recordings and Placed ones (`autoMapRecordings` in `pitch-coverage.ts`). A Noise-like Recording left out never reaches the renderer.
5. **It holds its note from 0.6 s.** Auto-map takes a Placed Recording with its own length, a shortest note of 0.6 s, and settled from its start (`placedAutoMapRecording` in `auto-map.ts`, and `placed()` in the reference's `engine.py`).
   - 0.6 s is the longest note `audition()` tries, so a placed fart ranks as the slowest Melodic Recording. At the same distance from a pitch, an analyzed fart gets the short notes, since an ear's placement is a guess and an analysis is a measurement.
   - A placed fart still plays short notes that nothing else covers, at the usual cost. The length rule (ADR 0011) uses its own length, as it does for every fart.
6. **It is stored with the Recording, apart from its analysis.**
   - In IndexedDB, `placedPitch` (a MIDI note, or null) is an optional field on the Recording. The database still goes to version 4, with no store changed: code from before #268 sends an outbox op it doesn't know, such as `place`, as a delete. Version 4 closes that code's connection and it can't open the library again (`VersionError`), so it never drains an outbox holding `place`. The upgrade also sets the last read's cursor back to 0, so each browser reads its whole library once, with any Placed Pitch a tab on the older build skipped.
   - In D1, it is a nullable `placed_pitch` column on `recordings` (migration 0004).
   - A placement queues in the outbox as `place`, merged like a rename, and goes up as `PATCH /api/recordings/{id}/`.
   - A new analysis replaces the analysis and keeps the placement. If it finds the fart Melodic, its Recording Pitch is used and the placement is ignored. The account takes any MIDI note from 0 to 127, so a later release can widen the picker.

   Update 2026-10-30 (ADR 0019, #293): the picker can also trim the fart. The `place` op and `PATCH /api/recordings/{id}/` now carry the Recording's Trim with its Placed Pitch, `{ placedPitch, trim }`, and either may be left out. The database goes to version 6 for the same reason as version 4, and its upgrade reads the whole library again.

## Why

**The owner's words.** Design A has the biggest keys and the most stock parts. Trying an octave up or down takes one arrow tap.

**0.6 s, from the data.** Each shortest-note value was measured on the golden full library. `009` and `080` were each placed on every note from C2 to B4, which makes 72 placements, across every golden Song.

| A placed fart's shortest note | Songs newly unlocked | Unlocked Songs that switch to it | for fewer Octave Moves | for a lower cost only |
| --- | --- | --- | --- | --- |
| 0.12 s | 108 | 398 | 178 | 220 |
| 0.2 s | 108 | 394 | 178 | 216 |
| 0.35 s | 108 | 354 | 178 | 176 |
| **0.6 s (chosen)** | **108** | **195** | **178** | **17** |
| Its own length | 108 | 178 | 178 | 0 |

How these read:
- The length doesn't change what a placement unlocks.
- A switch for fewer Octave Moves is Auto-map's ranking, and no length changes it.
- What the length changes is how often a guessed note pushes out a measured one only on cost. At 0.12 s that happens 220 times; at 0.6 s, 17 times.
- 0.6 s still lets a placed fart win where it is clearly closer. Using its own length would put it on a par with an analyzed fart that settles at once.

**Placed farts pass the bar (ADR 0012).** These are the reference renders of every app Song that plays a placed fart, through `evaluate.py`:

| Placement | Song | Placed notes | Notes within ±50 c of their fart | On time | Second attacks | Bar |
| --- | --- | --- | --- | --- | --- | --- |
| 080 on C2 | Twinkle, Twinkle, Little Star | 3 of 28 | 100% | 100% | 0 | Pass |
| 080 on C2 | Mary Had a Little Lamb | 4 of 26 | 100% | 100% | 0 | Pass |
| 080 on C2 | Jingle Bells (newly unlocked) | 14 of 26 | 100% | 100% | 0 | Pass |
| 080 on C2 | Frère Jacques | 2 of 32 | 100% | 100% | 0 | Pass |
| 080 on C2 | Row, Row, Row Your Boat (newly unlocked) | 7 of 27 | 100% | 100% | 0 | Pass |
| 080 on C2 | Ode to Joy | 6 of 30 | 100% | 100% | 0 | Pass |
| 080 on C2 | Auld Lang Syne (newly unlocked) | 10 of 29 | 100% | 100% | 0 | Pass |
| 009 on C2 | Frère Jacques | 2 of 32 | 100% | 100% | 0 | Pass |
| 080 on D♯2 | Seven Songs, When the Saints Go Marching In among them | 2 to 14 each | 100% | 100% | 0 | Pass |

- Every placed note reads within 50 cents of its fart, so it plays raw.
- In every render, 96 to 98% of the time sounds.
- The web engine renders Jingle Bells, Row, Row, Row Your Boat and Auld Lang Syne with 080 on C2 at the reference's transpositions, the same length to the sample. They differ from the reference by at most 4 × 10⁻⁶.

**Apart from the analysis.**
- The account keeps the analysis made at upload, and each browser makes its own. A Placed Pitch is the user's choice and can change after the upload.
- Kept apart, it survives a new analysis, and a placement changes one column.

## Options considered

| Option | Why not, or why |
| --- | --- |
| **Place it by ear, or leave it out (chosen)** | The owner's words. Songs stay melodic, and a fart left out behaves as before. |
| Beats: Songs play Noise-like farts as unpitched beats (ADR 0014, #262, PR #263) | Rejected by the owner: "we don't want that at all roll that back" (PR #267). |
| Design B, a full-screen piano roll | Not chosen. It needs the most custom code, and you scroll to find your spot. |
| Design C, a keyboard in the row | Not chosen. Its keys are smaller and scroll sideways, and every key tried moves the fart, since nothing confirms it. |
| Place it in Song Creator, per Song | The owner chose the Recordings tab: set once, used in every Song. |
| Shift the fart to the note | Breaks ADR 0012: Songs play farts raw. |
| A shortest note of 0.12 to 0.35 s, or the fart's own length | See the table: a guessed note would push out a measured one more often, or rank on a par with it. |
| F♯1 to A5, the whole analysis range | Adds 16 keys that no test fart reached, and a part-octave at each end. |
| Real piano samples | Need a licensed sample set and its download. The prototype's Web Audio tone was enough to compare with, and keeps the picker's sound in code. |
| Store it inside the analysis | A new analysis replaces the analysis, and the account keeps the analysis from the upload. The user's choice would be lost or mixed in with it. |

## Consequences

- **Web releases roll forward only past #268.** A build from before it can't open IndexedDB version 4, so a Cloudflare rollback past it leaves the library unopenable in every browser that opened #268's build, until a release rolls forward (`docs/agents/web.md`).
- **Migration 0004 must apply before the Worker that reads it.** CI applies D1 migrations before each deploy (`web.yml`).
  - A Worker from before #268 ignores `placedPitch` in an upload, and its library read leaves it out, which a browser reads as no change.
  - Such a Worker answers 405 to the PATCH. The browser then drops it from the outbox, as it does for a note the account refuses, and keeps the placement itself.
  - That placement reaches the account only when the user places the fart again. A later full read from a current Worker can take it off this browser.
  - This happens only when the page is newer than the Worker that answers, for example after a Worker rollback.
- A saved Toot keeps its audio. Its note captions show a Recording's Placed Pitch as it is now.
- The iPhone app doesn't have this. It is web only (ADR 0007).
- The Result screen still says "No steady note this time". Its next line said the fart can't play melody notes; it now says it can be placed on a note by ear on the Recordings tab. Placing happens only there, and the Support page says how.
