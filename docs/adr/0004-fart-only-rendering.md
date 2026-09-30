# Fart-only rendering: trim, resample, fade, mix

Earlier renderers failed audibly in three ways. They looped short clips, which turned one note into several attacks. They filtered the Fixture Library down to one or two Recordings. And they created pitch with tuned resonators, which sounded like sine waves rather than farts. The accepted engine, which the product owner judged MVP quality by ear on 2026-09-29, uses only these operations: trim each Recording to its single clean gesture, change its pitch by variable-rate resampling (following the Recording's own pitch contour so the note holds steady), fade, adjust gain, and mix. It never uses oscillators, resonators, looping or granular re-triggering.

Auto-map works like a multi-sampled instrument. It picks a transposition for the Song, then gives each needed pitch the nearest Melodic Recording, keeping shifts under an octave and keeping Recordings off notes too short for them to hold pitch. The Python melody lab (`tools/melody-lab/`) is the reference implementation. The Swift engine must match its planning decisions and pass the same checks: notes on pitch within ±50 cents, onsets within ±50 ms, and no second attack inside a note.

## Consequences

Only some Recordings are Melodic (9 of the 23 in the Fixture Library). Noise-like Recordings can't carry a recognizable melody by themselves. This is why Pitch Coverage and Unlocked Songs are part of the product.
