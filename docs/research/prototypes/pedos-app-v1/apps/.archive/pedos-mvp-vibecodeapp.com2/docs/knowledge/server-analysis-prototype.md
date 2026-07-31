# Server Analysis Prototype Notes

**Date:** 2026-03-21

## Goal

Try a stronger server-side sample analysis approach that estimates:

- reference note
- pitch confidence
- usable note range

and then uses that profile to score melody fit before generation.

## Prototype Setup

- Added `pitchy` to the backend for frame-level pitch + clarity detection
- Added a prototype profile aggregator in `backend/src/lib/prototype-pitch-profile.ts`
- Added a spike script in `backend/scripts/try-server-analysis.ts`
- Ran the script against the current `test-data/fart-samples/` library

## What We Saw

### 1. The current analyzer is probably overestimating pitch badly

The existing spectral-centroid-based `referenceMidi` values are often much higher than the prototype pitch detector result.

Examples from the spike:

- `044__walter-odington__fart-wav__69500.mp3`: current `73`, prototype `37`
- `017__breviceps__fart-3__446000.mp3`: current `70`, prototype `38`
- `023__the-fart__fart-attack__436834.mp3`: current `63`, prototype `31`

This supports the earlier suspicion that "centroid as note" is too aggressive.

### 2. Only a minority of samples look truly pitchable

The prototype only classified `8 / 39` samples as confidently pitchable.

That is a useful result, not a failure:

- it means the system should stop pretending every fart sample can act like an instrument note
- it means confidence gating is necessary
- it means poor-fit warnings are not optional UX polish, they are core product behavior

### 3. Melody-fit scoring became more realistic, but also harsher

The top melody scores were only moderate, and many melodies carried lots of risk notes.

That suggests:

- fit scoring is surfacing the real weakness of the sample set
- the app should recommend only a smaller subset of melodies for many sample selections
- fallback rules will matter a lot for generation

### 4. Raw pitch detection still needs guardrails

One sample produced an implausibly low prototype note (`midi=5`), which means:

- the detector can still lock onto subharmonics or noise artifacts
- the next iteration should add guardrails such as plausible-range filters, octave sanity checks, or attack-window-only analysis

## Practical Conclusion

The server-side direction looks correct.

Not because the first prototype is perfect, but because it revealed two important truths quickly:

1. the current note estimation is likely misleading
2. the product needs confidence-aware matching, not universal note assignment

## Recommended Next Step

Move this prototype toward production in two parts:

1. Improve the sample profiler
   - add octave / range sanity checks
   - analyze attack windows separately
   - add timbre/noisiness features alongside pitch confidence

2. Use the profile for preflight fit scoring first
   - rank melodies
   - recommend transpose
   - warn when the selected sample set is weak

This can land before the final render-engine upgrade and will already improve product behavior.
