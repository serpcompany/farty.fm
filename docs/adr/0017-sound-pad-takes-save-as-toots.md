# Sound Pad takes save as Toots

Until #278 the Sound Pad (#277) only played: what the user tapped was gone once it stopped sounding. #278 lets them record it. Record on the Sound Pad keeps which Pad was tapped and when, for up to 30 s. Stop makes it into a Toot, and saving it costs $0.99 through the paywall Song Creator uses (ADR 0010).

The owner decided four things on the issue:

- Saving costs $0.99 through the existing paywall, and hearing the take is free.
- The Pads' level, `PAD_PEAK` (0.5), is the one gain.
- Each fart plays raw, at its own pitch and speed (ADR 0004, ADR 0012).
- `pad-player` reports a sound that won't decode as `pad-sound-failed`, unless the audio failed to download (offline).

## Decision

1. **A Toot is of a Song or of a Performance, never both.**
   - A Pad Toot has `songId: null`, `arrangement: null` and a `performance`. A Song's Toot is unchanged, with no `performance`.
   - `Toot` and `TootDraft` in `toot.ts` are unions on that, so code that needs a Song (the note view, Song Creator's return from Checkout) can only get a Song's Toot.
   - A Pad Toot is titled "Sound Pad" until it's renamed, and the Toots tab shows "Sound Pad" where a Song's Toot shows its Song.
2. **A Performance is compact** (`performance.ts`): `{ recordings: [id, …], taps: [[seconds, index], …] }`.
   - Each Recording's id appears once, and each tap is a time and an index into that list.
   - Times run from the first tap, to the millisecond. The clock starts at the first tap after Record, not at Record.
   - A take stops by itself at 30 s from its first tap (the longest take, `maximumTakeSeconds`) or at 1000 taps. Hiding the page also stops it.
   - Only a press that played is kept. A press on a Pad whose sound is still loading is dropped from the take, as it is from playback.
   - The account checks every Performance it's given (`isPerformance` in `parseToot`): at least one tap, at most 1000, in time order from 0 to 30 s, each tap pointing at a Recording it names, and every Recording it names played.
3. **The render plays each tap as its Pad does** (`engine/render-performance.ts`, in the render worker).
   - Each Recording is resampled once to 44.1 kHz, the render's rate and its only resampling. `padSound` then trims it to its sounding span, fades its ends, and sets its peak to `PAD_PEAK`.
   - Each tap's sound starts at `round(at × 44100)` and the taps add up. Nothing loops, stretches, re-triggers or limits.
   - The Toot is as long as from the first tap to the end of the last sound.
4. **One more gain, only when the farts together would clip.** Two Pads peak at 1.0 together, and a 16-bit WAV holds up to 32767/32768.
   - When the mix's peak passes that, the whole mix is scaled once, so its peak lands at full scale. This changes the level only, never the shape, and only on takes that would otherwise clip.
   - Otherwise the gain is 1, and `PAD_PEAK` is the only gain.
   - See Options considered for why it isn't clipping or a limiter.
5. **Paying for it is Song Creator's flow** (`SaveToToots` in `song-creator.tsx`, shared by both).
   - `POST /api/toots/{id}/checkout/` with `songId: null` starts a payment for a Pad Toot. A body with no `songId` at all is still refused.
   - The payment row has no Song (`toot_payments.song_id` is null). Stripe's product reads "Save your Sound Pad Toot", and the dev checkout takes no `song`.
   - Checkout returns to `/compose/pad/?toot=…`.
   - `PUT /api/toots/{id}/` refuses an unpaid Pad Toot with 402, as it refuses a Song's.
6. **The take is kept across Checkout in this browser.**
   - Once a take is made, its Performance and Toot id go into `localStorage` (`pedos.padTake`, `pad-take.ts`), replacing any earlier take. They hold only ids and times, never audio.
   - Back from Checkout with the same id, the Sound Pad makes the same Toot again from them and saves it. It doesn't play it again, since it was heard already.
   - A save, or a new take, lets the old one go. Storage that can't be read keeps nothing, and the take then lasts only the page.
7. **No paid-unsaved reuse for Pad Toots.**
   - Song Creator reuses a Toot of the same Song that was paid for and never saved (#213), because it can make that Toot again from the Song and the Recordings. The account never sees a Performance before it's saved, so it can't make a Pad Toot again elsewhere.
   - A paid Pad Toot is never offered for a Song's, nor a Song's for the Sound Pad.
8. **It's stored as Toots are.**
   - In D1, `toots.song_id` and `toots.arrangement` become nullable, beside a new JSON `performance` column. A `CHECK` holds a Toot to one or the other (migration 0005).
   - SQLite can't change a column's nullability in place, so 0005 rebuilds the table, as drizzle-kit wrote it. Its `INSERT` was edited by hand to leave out `performance`, which the old table doesn't have. `toots-migration.workers.test.ts` runs it on a D1 that already holds Toots, both live and deleted.
   - In IndexedDB the Toot record just has one more field, so no store changes and `DB_VERSION` stays 5.
   - The audio is a 44.1 kHz mono 16-bit WAV, like any Toot's, so the Toots tab, sync and playback treat it as one.
9. **Its Toot screen is the take's player**: Play, its state, and "0:02 · 5 taps of 2 Recordings". A Pad Toot has no notes, so it has no note view.

## Why

**One Toot, not a new kind of item.** Toots already sync, play, rename, delete and have a paywall. A Pad Toot uses all of that, and the only new data is the Performance.

**The Performance, as small as it can be.** An upload has 64 KB of room beside its audio, for the metadata and the multipart boundaries. 1000 taps of 12 Recordings as `{ at, recordingId }` objects take about 66 KB. As `[at, index]` pairs, they take about 11 KB.

**Measured.**

- **Unit tests** (`render-performance.test.ts`, on the Fixture Library):
  - Every onset is within 0 samples of `round(at × 44100)`.
  - The render minus the sum of each tap's `padSound` leaves about 1.5e-8, which is float rounding. Every sample outside the farts is 0.
- **Through the render worker:** `makePadToot` gives the same samples as the engine.
- **E2E journey** (`sound-pad.spec.ts`, Workers build, phone and tablet): five taps of 095 (F2) and 090 (G3).
  - Each kept tap is within 0.5 ms of its press.
  - librosa finds an onset within 50 ms of every tap, 5 of 5, at 1.6 to 23.2 ms.
  - One fixed sound per Recording, placed at its taps, explains the stored Toot to a residual of 4.1e-6 rms. That is under 16-bit quantization's 8.8e-6.
  - Each fitted sound matches its stored Recording, with a normalized correlation of 1.00000. YIN reads it within 0.00 cents (median) of the Recording, with 100% of loud frames within 50 cents.
  - The app's renderer, run on the stored Recordings, gives the stored Toot's WAV byte for byte.

## Options considered

| Option | Why not, or why |
| --- | --- |
| **A Toot of a Performance (chosen)** | Saving, paying, syncing and playing are a Toot's already. |
| A catalog "Song" for the Sound Pad | A Song needs a cited score (ADR 0003), and the Song code would treat a take as notes. |
| Clip the mix, or a limiter like the Song render's | Clipping squares off the farts' peaks. A limiter changes each fart's shape where they overlap. A single gain on the whole mix changes neither, and only applies when the mix would clip. |
| Keep the take in IndexedDB | That needs a new store and `DB_VERSION` 6 for one small record, which `localStorage` holds. |
| Render on playback from the Performance | A Toot's audio is its WAV everywhere: in sync, offline and in another browser. Rendering again would need every Recording's audio first. |

## Consequences

- A build from before #278 that syncs an account with a Pad Toot plays it from the Toots tab. It shows no Song name in the row, and its Toot screen says the Song isn't in Farty.
- A Pad Toot paid for whose return from Checkout never loads (the page closed at Stripe) is saved only if its return address is opened later in the same browser, before another take. The Sound Pad opened without it doesn't ask the account whether the kept take was paid, so that payment goes unused and is refunded by hand (ADR 0010).
