# Implementation Phases: Fart Melody Accuracy v3

**Project Type**: Existing mobile + backend audio feature improvement
**Stack**: Expo React Native + Bun + Hono + FFmpeg
**Estimated Total**: 20 hours (~1,000-1,200 minutes human time)

---

## Goal

Make generated fart songs more recognizable by profiling each selected sample more accurately, scoring how well that sample set fits each melody, then rendering notes using those profiles instead of forcing rough guesses.

## Working Assumptions

- Priority is better melody recognition while keeping the fart character intact.
- Whole-song auto-transpose is allowed when it materially improves the fit.
- The helper sine tone should be removed, not tuned.
- Bundled fart samples and user-recorded farts should go through the same analysis model.
- We should prefer well-supported existing audio-analysis libraries over custom DSP when they clearly improve results.

## Important Framing

A single fart sample usually does **not** have a meaningful musical key. For matching, the useful signals are:

- Reference note / pitch center
- Pitch confidence / tonal strength
- Usable pitch range
- Attack and sustain behavior
- Brightness / timbre role
- Loudness and duration

"Key" becomes useful at the **melody + selected sample set** level as a recommended transpose, not as a core per-sample field.

---

## Phase 1: Baseline, Paths, and Diagnostics
**Type**: Infrastructure
**Estimated**: 3 hours
**Files**: `backend/src/lib/paths.ts`, `backend/src/routes/musical-fruit.ts`, `backend/src/lib/midi-parser.ts`, `backend/src/lib/sample-analyzer.ts`, `backend/scripts/quality-test.ts`, `docs/knowledge/fart-song-accuracy-baseline.md`

**Tasks**:
- [x] Centralize repo-relative paths for samples, melodies, cache, temp files, and output files instead of hard-coding `/home/user/workspace` and `/tmp`.
- [x] Move generated temp/output artifacts to a project-local temp folder so local testing is repeatable and compliant with repo workflow.
- [x] Make the local quality harness runnable in this workspace and capture the current baseline scores for a fixed sample matrix.
- [ ] Add per-generation diagnostics that log transpose, sample assignment, pitch ratio, tempo ratio, and fallback decisions.
- [x] Write a short knowledge note with current baseline findings and known blockers.
- [ ] Confirm the existing mobile Create flow still works against the updated backend paths.

**Verification Criteria**:
- [ ] `bun run scripts/quality-test.ts` runs successfully in `backend/`.
- [ ] At least one generated song produces a diagnostic artifact that explains note-to-sample assignments.
- [ ] `POST /api/musical-fruit/generate` returns 200 for a valid sample set.
- [ ] Invalid melody returns 400.
- [ ] Missing sample path returns 400.
- [ ] A forced generation failure still returns 500 with the existing error envelope.

**Exit Criteria**: Accuracy work is measurable, reproducible locally, and no longer blocked by path or setup issues.

---

## Phase 2: Sample Analysis v2
**Type**: API
**Estimated**: 4 hours
**Files**: `backend/src/lib/sample-analyzer.ts`, `backend/src/lib/sample-profile.ts`, `backend/src/routes/musical-fruit.ts`, `test-data/fart-samples/analysis.json`, `docs/knowledge/fart-song-analysis-model.md`

**Tasks**:
- [ ] Replace the current "spectral centroid = pitch" shortcut with a richer `SampleProfile`.
- [ ] Store, at minimum: `referenceMidi`, `pitchConfidence`, `usableMinMidi`, `usableMaxMidi`, `brightness`, `duration`, `loudness`, `attackMs`, `sustainMs`, and `tonalStrength`.
- [ ] Benchmark the current approach against at least one stronger existing option such as `pitchy`, Essentia.js, or another reliable pitch-confidence tool, then choose one approach for production.
- [ ] Detect low-confidence / noisy samples and stop treating them as reliable pitched notes.
- [ ] Update cache generation so bundled and uploaded/user-recorded samples produce the same profile shape.
- [ ] Document clearly why "sample note" is useful and "sample key" is usually not.

**Verification Criteria**:
- [ ] All bundled fart samples regenerate a valid v2 profile cache.
- [ ] The new profile exposes confidence/range information for both pitched and noisy samples.
- [ ] `POST /api/musical-fruit/analyze-recording` returns 200 with the new profile fields.
- [ ] Invalid upload returns 400.
- [ ] No-auth behavior is intentional and documented for this public endpoint.
- [ ] A forced analyzer failure returns 500 with the expected error envelope.

**Exit Criteria**: Each sample has an explainable, confidence-scored profile that can be trusted for fit scoring and note assignment.

---

## Phase 3: Melody Fit Scoring and Recommendations
**Type**: API
**Estimated**: 3 hours
**Files**: `backend/src/lib/melody-fit.ts`, `backend/src/routes/musical-fruit.ts`, `backend/scripts/quality-test.ts`, `docs/knowledge/fart-song-fit-scoring.md`

**Tasks**:
- [ ] Build a fit scorer that evaluates each melody against the selected sample set using transpose allowance, note coverage, average pitch-shift distance, duration fit, and sample confidence.
- [ ] Return a recommended transpose and an explanation payload instead of only a single match score.
- [ ] Penalize melodies that need extreme pitch shifts, excessive time-stretching, or repeated use of low-confidence samples.
- [ ] Surface "best register coverage" and "risk notes" so the app can explain why a melody is or is not a good fit.
- [ ] Add fixture-based regression cases for a few representative sample sets.
- [ ] Update docs with the scoring model and tuning rules.

**Verification Criteria**:
- [ ] `POST /api/musical-fruit/recommend-melodies` returns 200 with ranked melodies and explanation fields.
- [ ] Invalid sample paths return 400.
- [ ] Endpoint remains intentionally public and that is documented.
- [ ] A forced scorer failure returns 500.
- [ ] Known "good fit" sample sets rank more recognizable melodies near the top in the regression fixtures.

**Exit Criteria**: The system can tell the user which songs fit their selected samples and why, before generation begins.

---

## Phase 4: Generation Engine v3
**Type**: API
**Estimated**: 4 hours
**Files**: `backend/src/routes/musical-fruit.ts`, `backend/src/lib/note-renderer.ts`, `backend/src/lib/sample-profile.ts`, `backend/scripts/quality-test.ts`, `docs/knowledge/fart-song-generation-v3.md`

**Tasks**:
- [ ] Remove the helper sine tone completely from note rendering.
- [ ] Use sample profiles to choose note renderers by register, confidence, attack behavior, and duration fit rather than nearest MIDI only.
- [ ] Add hard safety limits for pitch-shift and time-stretch so impossible notes are remapped or warned about instead of forced.
- [ ] Use attack-window trimming or start offsets so long samples begin on the useful part of the sound.
- [ ] Add explicit fallback rules for bad-note situations: alternate sample, octave remap, skip with silence, or user-facing warning.
- [ ] Re-run the quality harness after each major tuning change and log the before/after result.

**Verification Criteria**:
- [ ] Generated output still returns 200 and plays end-to-end after sine removal.
- [ ] Invalid melody returns 400.
- [ ] Invalid sample path returns 400.
- [ ] A forced FFmpeg/render failure returns 500.
- [ ] Phase 1 baseline sample sets show measurable quality improvement in the harness.
- [ ] Human listening check says the target melody is more recognizable without the helper tone.

**Exit Criteria**: Generation is driven by real sample profiles, avoids forced ugly stretches, and produces more recognizable songs without artificial pitch assistance.

---

## Phase 5: Recorded Fart Support and Explainability
**Type**: Integration
**Estimated**: 3 hours
**Files**: `backend/src/routes/musical-fruit.ts`, `mobile/src/app/(tabs)/create.tsx`, `mobile/src/lib/api/api.ts`, `mobile/src/lib/state/recordings-store.ts`, `docs/FEATURES.md`

**Tasks**:
- [ ] Extend the selection flow so user-recorded samples can be profiled and scored by the same backend logic as bundled samples.
- [ ] Show users why a melody is recommended: suggested transpose, strongest register match, and any quality warning.
- [ ] Show a warning when the selected sample set is a poor fit before generation starts.
- [ ] Keep the UI behavior lightweight and understandable rather than overly technical.
- [ ] Update user-facing feature docs to reflect the new flow and recommendation behavior.
- [ ] Add or update integration checks for the recording-to-generation path.

**Verification Criteria**:
- [ ] A bundled sample set and a user-recorded sample can both be analyzed by the same API shape.
- [ ] The Create screen shows recommendation reasoning and poor-fit warnings.
- [ ] A user can still complete the generate flow end-to-end from the Create tab.
- [ ] Network or upload failure states are visible and recoverable.
- [ ] Regression: existing bundled-sample generation still works after recording support lands.

**Exit Criteria**: Bundled and user-recorded samples share one explainable matching flow, and users can see fit quality before generating.

---

## Phase 6: Acceptance Tuning and Release Readiness
**Type**: Testing
**Estimated**: 3 hours
**Files**: `backend/scripts/quality-test.ts`, `docs/TESTING.md`, `docs/knowledge/fart-song-acceptance-results.md`, `docs/midi-melody-plan.md`, `docs/SESSION.md`

**Tasks**:
- [ ] Define final acceptance thresholds using both automated scores and human listening checks.
- [ ] Run the full regression matrix across bundled samples, mixed sample sets, and at least a few user-recorded examples.
- [ ] Capture any melody/sample combinations that still sound bad and turn them into explicit warnings or exclusions.
- [ ] Refresh older docs so the current plan supersedes the now-mostly-complete MIDI plan.
- [ ] Record final findings, open risks, and follow-up opportunities in docs.
- [ ] Mark completed planning and implementation checkpoints in `docs/SESSION.md`.

**Verification Criteria**:
- [ ] Automated quality matrix runs successfully.
- [ ] Median harness score improves against the Phase 1 baseline by an agreed threshold.
- [ ] No major regression remains hidden in the top recommended melodies.
- [ ] Human listening pass can identify target melodies for the primary test set.
- [ ] Docs reflect the implemented reality instead of the old plan.

**Exit Criteria**: The feature has measurable acceptance criteria, updated documentation, and a clear release-ready baseline.

---

## Notes

**Testing Strategy**: Automated quality harness plus human listening matrix. See `docs/TESTING.md`.

**Deployment Strategy**: Keep backend deployable after each phase; do not bundle multiple algorithm changes without a fresh baseline run.

**Context Management**: Each phase is intentionally capped to a small set of files and one decision layer so implementation can fit within a single focused session.

**Recommended Implementation Order**:
1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
