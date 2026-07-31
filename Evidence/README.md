# Approved Fixture Library Recording Analysis

This is evidence for the throwaway post-save Recording Analysis prototype, not
production data.

Run:

```sh
zsh Tools/run-fixture-analysis
```

The harness applies the same `windowed-yin-v2` analyzer used by the iOS proof to
all 23 product-owner-approved Recordings from
`prototype/internal-fixture-library`. It writes the full machine-readable
results to `recording-analysis-corpus.json` before opening the listening review
loop.

## Observed result

- 23 of 23 approved Recordings decoded and analyzed.
- 10 produced a confidence-gated reference pitch and stable detected bounds.
- 13 explicitly remained not confidently pitched.
- No Recording was assigned a pitch from brightness.
- No analysis failed.

The result deliberately does not claim that the ten pitched classifications are
correct by itself. Product-owner listening review is the approval gate.

## Review edges

- Approved Recording `018` has a long quiet lead/tail and only about 0.12
  seconds survives the usable-region gate.
- Approved Recordings `055` and `081` also have only about 0.13 seconds of
  detected usable audio.
- Approved Recording `094` has the widest stable detected pitch span in this
  run, about 4.4 semitones.
- Pitch confidence ranges from about 22% to 82% among the ten profiles that
  clear the gate.

These are inputs to the next Melody Fit and rendering proof, not reasons to
silently normalize, trim, or reject a Recording during capture.
