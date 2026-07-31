# Fart Song Accuracy Baseline Notes

**Date:** 2026-03-21

## Current Reality

The current repo is already past the older MIDI-upgrade plan:

- MIDI parsing exists
- Rubberband pitch-shifting exists
- Rest handling exists
- Fade handling exists
- A quality harness exists

That means the remaining accuracy problem is more likely caused by:

- Weak sample profiling
- Weak song-fit scoring
- Over-forced note rendering
- Dependence on the helper sine tone

## Key Discovery

The current analysis model effectively treats spectral centroid like pitch. That may be directionally useful for "bassy vs squeaky," but it is probably too weak to drive true note matching by itself.

## Planning Direction

For single fart samples, prioritize:

- reference note
- pitch confidence
- usable range
- attack/sustain behavior
- timbre role

Do **not** over-invest in "sample key" because that is usually a melody-level concept, not a single-sample concept.

## Local Workflow Blockers Found

- Several backend files hard-code `/home/user/workspace/...` paths even though this workspace lives elsewhere.
- Several backend scripts and helpers write to `/tmp/...`, which makes local iteration and repo organization weaker than it should be.
- The quality harness did not run cleanly in this workspace because backend dependency resolution is not currently healthy.

## Debugging Progress

### Fixed

- Added a shared backend path helper so audio assets, melodies, cache, and generated artifacts resolve relative to the actual repo.
- Moved backend temp/output directories under project-local `tmp/backend/...`.
- Added tests covering repo-relative paths and project-local temp usage.
- Reworked the quality harness so its sample sets are derived from the samples that actually exist in `test-data/fart-samples/` rather than old hard-coded filenames.

### Still Blocking Baseline

- The local FFmpeg build does **not** include the `rubberband` filter.
- Reproduced directly with:
  - `ffmpeg -filters | rg rubberband` → no match
  - a manual render command → `No such filter: 'rubberband'`
- Added a fallback FFmpeg render path using `asetrate + aresample + atempo`, which restored local generation and made the quality harness runnable again.

### Why This Matters

- The current generation path depends on `rubberband` both in the API route and in the quality harness.
- On this machine, the original `rubberband` path cannot complete, so local generation now relies on the fallback render path for testing.

### Additional Discovery

- The current sample library has changed significantly from the older PacDV/SoundBible filenames.
- Any hard-coded fixture list that references names like `bean-fart.mp3` or `fart-4.wav` is now stale in this repo snapshot.

### Latest Verification

- `bun run scripts/quality-test.ts` now completes successfully and reports strong scores across the three sample sets.
- Direct in-process calls to the existing Hono route return `200` for:
  - `POST /api/musical-fruit/recommend-melodies`
  - `POST /api/musical-fruit/generate`
- That means the current backend contract the Create screen already uses is working again in local code.
- Mobile-side local-dev debugging showed the app was too fragile around backend URL resolution:
  - it depended directly on `EXPO_PUBLIC_BACKEND_URL`
  - it surfaced only a generic "Failed to load" state
- The mobile API layer now:
  - resolves the backend from `EXPO_PUBLIC_BACKEND_URL` when present
  - falls back to Expo's dev host (`Constants.expoConfig.hostUri`) on local runs and uses port `3002`
  - throws real network and HTTP errors with the request URL included
  - reuses the same backend URL builder for previews, recording analysis, and generated-song playback
- Web verification succeeded both:
  - with `EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:3002`
  - and with no backend env var set, relying on the new Expo-host fallback

## Helper Tone Removal

- The generation path previously mixed each rendered fart note with a subtle synthetic `sine` tone.
- That helper layer has now been removed from:
  - `backend/src/routes/musical-fruit.ts`
  - `backend/scripts/quality-test.ts`
- Rendering now stays fart-only and uses one FFmpeg pass per note with:
  - pitch/time filter
  - note velocity via `volume=...`
  - attack/release fades

### Verification After Removal

- `bun test src/lib/pitch-render.test.ts` passes, including a regression test that rejects `sine=` and `amix=`.
- `bun run typecheck` passes.
- `bun run scripts/quality-test.ts` still completes, but the scores drop materially once the helper tone is gone:
  - All samples: Twinkle `32`, Happy Birthday `41`, Jingle Bells `35`
  - Wide range: Twinkle `43`, Happy Birthday `47`, Jingle Bells `45`
  - Mid range: Twinkle `36`, Happy Birthday `42`, Jingle Bells `36`
- Direct route verification still succeeds:
  - `POST /generate` returns `200`
  - example output: `twinkle_f668ef76.wav`

### What This Means

- The helper tone was masking weaknesses in sample-note matching.
- Now that it is removed, the remaining pitch accuracy problem is more honest and easier to tune scientifically.
- The next quality gains need to come from:
  - better sample profiling
  - better melody/sample fit scoring
  - better note assignment and transposition choices

## Immediate Recommendation

Treat Phase 1 as mandatory:

1. path cleanup
2. runnable baseline harness
3. diagnostics per generation

Without those, future tuning work will stay guessy.
