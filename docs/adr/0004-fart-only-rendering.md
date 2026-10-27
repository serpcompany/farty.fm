# Fart-only rendering: trim, resample, fade, mix

Earlier renderers failed audibly in three ways. They looped short clips, which turned one note into several attacks. They filtered the Fixture Library down to one or two Recordings. And they created pitch with tuned resonators, which sounded like sine waves rather than farts. The accepted engine, which the product owner judged MVP quality by ear on 2026-09-29, uses only these operations: trim each Recording to its single clean gesture, change its pitch by variable-rate resampling (following the Recording's own pitch contour so the note holds steady), fade, adjust gain, and mix. It never uses oscillators, resonators, looping or granular re-triggering.

Auto-map works like a multi-sampled instrument. It picks a transposition for the Song, then gives each needed pitch its own Melodic Recording, shifted by at most 3 semitones, and keeps Recordings off notes too short for them to hold pitch. The owner rejected stretching one fart across many notes as "kinda lame" (decisions recorded on #47). So Songs unlock only when this one-fart-per-note assignment exists, and a larger shift is never used. The reference planner in `tools/melody-lab/` still reuses Recordings and allows shifts up to 12 semitones. #43 updates it to this rule, and until then its renders (including the #47 prototype's audio) don't follow it. The Python melody lab (`tools/melody-lab/`) is the reference implementation. The Swift engine must match its planning decisions and pass the same checks: notes on pitch within ±50 cents, onsets within ±50 ms, and no second attack inside a note.

Update 2026-10-05: a Recording may also play a pitch an octave away, resampled by 12 semitones plus at most 3, where a Song needs it (an Octave Move, ADR 0006). That replaces "a larger shift is never used". Everything else here stands.

Update 2026-10-28 (ADR 0012, #226): Songs play every fart raw, at its own pitch and speed. Rendering no longer resamples a fart to change its pitch: it trims, cuts at the note's end, fades, adjusts gain and mixes. The bar's "notes on pitch within ±50 cents" becomes "notes within ±50 cents of their fart's own pitch". Onsets on time and no second attack stand. So does the unlock rule: one fart per pitch, within 3 semitones of the note, now the furthest a note may be from the fart that plays it.

## Consequences

Only some Recordings are Melodic (9 of the 23 in the Fixture Library). Noise-like Recordings can't carry a recognizable melody by themselves. This is why Pitch Coverage and Unlocked Songs are part of the product.
