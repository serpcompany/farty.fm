# Noise-like farts can be trimmed

Until #293 a Recording's waveform didn't move while it played. That held on its row and in the place-by-ear picker (ADR 0015). The picker showed the fart's length, but its play button played the whole take, silence included (ADR 0016). Songs play the fart Recording Analysis found, which since ADR 0016 runs from the first attack to the last fade-out. In a Noise-like take that can begin with a blip before the fart itself. Recording `065`'s fart starts with a blip at 0.59 s, and the fart comes 0.3 s later. Placed on a note, it plays the blip on the beat. On 2026-10-30 the product owner said, with a screenshot of the picker:

> "can we use some kind of better waveform component or something that the user can see where the playback is…. or maybe let him manually trim/crop the recordings?"

They chose design B of #293's mockups the same day and settled the following:

1. **A playhead follows replay.**
   - While a Recording plays, a pink line crosses its waveform and fills the bars behind it. This happens on its row and in the picker. The line follows the player's audio clock (`playbackPosition()` in `audio/player.ts`).
   - A tap on the waveform plays from that spot. A drag of more than 6 px scrubs: the line follows the finger, and letting go plays from there.
   - A row plays to the end of what it plays. The picker plays to the fart's end, or, from a spot after it, to the end of the take.
   - For a screen reader the waveform is a slider ("Play Recording 3 from a spot"), and the arrow keys move a twelfth of it.
2. **The picker zooms to the fart.**
   - Its waveform shows the fart with a little of the take on either side. Under it, the whole take is drawn small, with a box where the zoom is.
   - Its play button plays just the fart: the one analysis found, or the Trim.
3. **Trim keeps part of a Noise-like fart.**
   - The picker's Trim button shows two handles, "Where the fart starts" and "Where the fart ends", with a readout ("0.89 s to 2.08 s"). A handle moves in 0.01 s steps, and the two stay at least 0.05 s apart.
   - "Save trim" keeps the Trim. So does "Place at E3" or "Move to G2" when the handles have moved.
   - "Reset" puts the handles back on the fart Farty found. With them there, "Remove trim" takes the Trim off.
   - Only a Noise-like or placed Recording can be trimmed, since only those have the picker (ADR 0017). A Trim stays whether the fart is placed or left out.
4. **A Trim plays everywhere.**
   - The row plays and draws only the Trim, and says "Trimmed" under the name. The picker and Songs play the Trim too.
   - The fart's length on screen and the length rule (ADR 0011) measure the Trim.
   - This is the one exception to ADR 0016's "the Recordings tab plays the whole take". An untrimmed Recording behaves as before.
5. **The handles say where to look; the fart is found between them.**
   - `trimBounds()` in `analysis/trimming.ts`, like `trim_bounds()` in the reference's `engine.py`, cuts the take at the handles, at whole samples of the 44.1 kHz audio. It then finds the fart in that part as `noteSegment()` finds a Recording's fart (ADR 0016). The start moves to just before the attack, the first 5 ms frame within 12 dB of the part's peak, less 8 ms. The end moves to where the fart fades out.
   - So a Trim always lies within its handles, and its onset lands on the beat as an untrimmed fart's does.
   - The Trim found is the one stored, so the handles open there next time. When it is the fart analysis found, to within 5 ms, nothing is stored (`samePart()`).
6. **Songs cut a trimmed fart at its Trim.**
   - `renderSource()` cuts the Recording at the Trim's samples instead of at the fart analysis found. The per-note cut, fade, gain and 25 ms gap stay as ADR 0012 set them.
   - Auto-map counts the Trim's length (`placedAutoMapRecording()` with `trimSeconds()`), and so does Pitch Coverage (`fartSeconds()`).
   - In the reference, `trimmed()` makes the same `Source` and `test_trim.py` checks it.
   - A Trim is a cut of the Recording, played at its own pitch and speed. Songs stay fart-only (ADR 0004, ADR 0012).
7. **A Trim doesn't re-read pitch.**
   - A Noise-like Recording has no Recording Pitch to read again, and a Trim never changes a Placed Pitch.
   - A new analysis keeps the Trim, a Re-scan's and the upgrade's among them (ADR 0017). It changes only the Recording's analysis, in IndexedDB and on screen, so a Trim saved while one runs stays.
   - If a new analysis finds the fart Melodic, the Trim goes with the Placed Pitch (`trimOf()`). On a placed Recording both stay in use, since a placement outlasts a Recording Pitch found later (ADR 0017). On one that isn't placed, the Trim is kept but not used, and the fart plays as analysis found it. In the reference, `trimmed(..., placed_by_ear=True)` trims a Melodic Recording that is placed.
   - A Re-scan reads the whole take, never the Trim, as every analysis does.
8. **The saved take never changes, and the Trim is stored beside it.**
   - A Trim is `{ startSeconds, endSeconds }`: seconds of the whole take, at the 44.1 kHz samples analysis reads, with the end exclusive (`Trim` in `recordings.ts`).
   - **IndexedDB.** `trim` is an optional field on the Recording, a Trim or null, kept apart from its analysis.
   - **D1.** `recordings` has nullable `trim_start_seconds` and `trim_end_seconds` columns (`real`, migration 0006, after #291's 0005). A Recording has both or neither.
   - **Sync.** A Trim goes through the same outbox op as a Placed Pitch, `place`, merged like a rename. When the op is sent, `PATCH /api/recordings/{id}/` uploads the Recording's current Placed Pitch and Trim together, `{ placedPitch, trim }`. The PATCH takes either field or both, and a field left out stays as it is. An upload carries `trim` too, and the library read returns it.
   - **`DB_VERSION` moves to 6,** with no store changed. Code from before #293 shares the browser's database, and it would undo or skip Trims. It would send a `place` op that a current tab queued for a Trim as `{ placedPitch }` alone, and settle it, so the Trim never reaches the account. It would also read the account's changes without keeping their Trims, and move its cursor past them. Version 6 shuts that code out as version 4 did (ADR 0015): its connection closes, and it can't open the library again (`VersionError`). The upgrade also sets the cursor back to 0 (`readEverythingAgain`), so each browser reads its whole library once, with the Trims another browser saved.

## Why

### What a Trim keeps

On `065`, handles at 0.8 s and 2.3 s leave out the blip and keep the fart's two loud bursts:

| | Start | End | Length |
| --- | --- | --- | --- |
| The fart analysis found | 0.591 s (sample 26048) | 2.080 s (sample 91740) | 1.49 s |
| The Trim, handles at 0.8 s and 2.3 s | 0.887 s (sample 39108) | 2.082 s (sample 91820) | 1.20 s |

The handle at 0.8 s is 87 ms before the Trim's start, which is itself 8 ms before the attack, as every fart's start is. Cutting at the handle would put 87 ms of near-silence on the beat, so every note this fart plays would start 87 ms late. ADR 0012's timing bar allows 50 ms (`onsets_on_time_pct`). Finding the attack between the handles keeps the onset on the beat, wherever a finger leaves the handle.

### What it does to Songs

The scenario `tools/melody-lab/scenarios/trim-065.json` uses the small library's Recordings 002, 016, 022, 069 and 090, with `065` placed on C2. `render-songs.ts --scenario` renders it with the web engine, and `evaluate_renders.py --against-reference --scenario` runs `evaluate.py`'s checks on each render and compares it with the reference's. The same library with `065` placed and untrimmed was measured the same way:

| Song | `065` untrimmed | `065` trimmed |
| --- | --- | --- |
| Mary Had a Little Lamb | **fails the bar**: 3 notes re-attack (`notes_with_retrigger`), 4 notes mostly silent. Transposition −33, 8% of notes within 50 cents of the tune, typical distance 70.0 cents, contour 59%, sounding 85% | **passes**: 0 notes re-attack, 0 notes mostly silent. Transposition −36, 42% within 50 cents, typical distance 32.6 cents, contour 12%, sounding 85% |
| When the Saints Go Marching In | passes. 7 notes mostly silent, sounding 78%, contour 19% | passes. 0 notes mostly silent, sounding 91%, contour 33%, typical distance 512.6 cents |
| Row, Row, Row Your Boat | passes. 7 notes mostly silent, sounding 77% | locked: it needs a 1.5 s fart on F2, and the Trim is 1.20 s |

Both trimmed renders hold every note within 50 cents of its fart (100%), with 100% of onsets on time. The web render matches the reference's to 3.35e-06 on Mary (−109.5 dBFS) and 1.63e-06 on Saints (−115.7 dBFS). The untrimmed notes that fall mostly silent are short ones that play the blip and then the gap. Trimming makes the fart shorter, so a Song that needs a long note from it can lock, as Row does here. Remove trim brings the whole fart back.

Untrimmed Recordings render as before: the web engine's renders of the 13 golden Songs all pass `evaluate_renders.py --against-reference`, and the largest sample difference from the reference's render is −98.0 dBFS.

### One op, not a new one

The outbox keeps one entry per item, and a newer op replaces an older one (`mergeOutbox()`). A separate op for the Trim would replace a `place` queued just before it, and the Placed Pitch would never go up. The op reads the Recording when it's sent, so one `place` op that carries both fields sends whatever the Recording holds then. The last change wins on the account, as it does for a Placed Pitch.

## Consequences

- **Web releases roll forward only past #293.** A build from before it can't open IndexedDB version 6. A Cloudflare rollback past it leaves the library unopenable in every browser that opened #293's build, until a release rolls forward (`docs/agents/web.md`).
- **The migration must apply before the Worker that reads it.** CI applies D1 migrations before each deploy (`web.yml`).
  - A Worker from before #293 accepts the PATCH and ignores `trim`, so the browser settles the op and the Trim stays only in that browser. The Trim reaches the account only when the user saves it again. A later full read from a current Worker can then take it off this browser.
  - Such a Worker also ignores `trim` in an upload, and its library read leaves it out, which a browser reads as no change.
  - This happens only when the page is newer than the Worker that answers, for example after a Worker rollback.
- A saved Toot keeps its audio. A Trim saved later doesn't change it.
- The iPhone app doesn't have this. It is web only (ADR 0007), and Swift stays frozen.
- ADR 0015 and ADR 0016 carry dated notes where this changes them.
