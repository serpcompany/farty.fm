# Testing Strategy: Fart Melody Accuracy

**Purpose:** Verify that "sounds more accurate" is measured, not guessed

**Date:** 2026-03-21

---

## Test Layers

### 1. Analysis Regression

Validate that each sample profile is stable and useful.

- Confirm `referenceMidi` is present only when confidence justifies it.
- Confirm noisy samples are flagged with low confidence rather than fake certainty.
- Confirm `usableMinMidi` / `usableMaxMidi` stays believable for short and long samples.
- Confirm bundled and uploaded samples return the same profile fields.

### 2. Recommendation Regression

Validate that the fit scorer makes believable ranking decisions.

- Good mixed-register sample sets should rank simple melodies near the top.
- Narrow-register sample sets should receive clear transpose suggestions and warnings.
- Very weak sample sets should still return results, but with lower scores and explicit risk notes.

### 3. Generation Regression

Validate that the rendered audio improves without the helper sine tone.

- Use the existing `backend/scripts/quality-test.ts` as the core harness.
- Run the same fixed sample matrix before and after each major tuning change.
- Store baseline and comparison outputs in a project-local temp/report folder.
- Do not accept "sounds better to me" as the only evidence.

### 4. Human Listening Check

Automated scores matter, but recognizability is the product goal.

Use a short listening matrix:

- 5 melodies
- 3 bundled sample sets
- 3 user-recorded sample sets
- 2 listeners when possible

For each output, capture:

- Melody identifiable within the first two phrases: yes/no
- Sound remains fart-like rather than synthetic: yes/no
- Obvious bad notes or jumps: none / minor / major
- Overall result: pass / needs tuning / reject

---

## Acceptance Targets

Phase 1 establishes the baseline. Final acceptance should target:

- Median automated quality score improves by at least 15 points versus the Phase 1 baseline on the primary bundled-sample matrix.
- No primary test melody regresses by more than 5 points after final tuning.
- At least 80% of the human listening matrix identifies the intended melody.
- Helper sine tone is fully removed in final accepted outputs.
- Fit warnings appear before generation for obviously poor sample sets.

If those thresholds prove unrealistic after the Phase 1 baseline, revise them once, document why, and keep the revision explicit.

---

## API Verification Checklist

### `POST /api/musical-fruit/analyze-recording`

- [ ] Valid upload returns 200 with sample profile fields
- [ ] Missing file returns 400
- [ ] Public/no-auth behavior is intentional and documented
- [ ] Forced analyzer failure returns 500

### `POST /api/musical-fruit/recommend-melodies`

- [ ] Valid sample paths return 200 with ranked results
- [ ] Missing sample path returns 400
- [ ] Public/no-auth behavior is intentional and documented
- [ ] Forced scorer failure returns 500

### `POST /api/musical-fruit/generate`

- [ ] Valid request returns 200 with playable output URL
- [ ] Invalid melody returns 400
- [ ] Missing sample path returns 400
- [ ] Forced render failure returns 500

---

## Manual UX Verification

### Create Screen

- [ ] Recommendation list updates after sample selection
- [ ] Recommended transpose is visible in understandable language
- [ ] Poor-fit warning appears before generate
- [ ] Generation can still proceed if the user chooses to continue

### Recorded Sample Flow

- [ ] User recording can be analyzed using the same backend profile model
- [ ] Recorded sample can participate in recommendation scoring
- [ ] Recorded sample generation failure states are understandable and recoverable

---

## Documentation Tasks

- [ ] Record baseline and final results in `docs/knowledge/`
- [ ] Refresh outdated feature docs once implementation is complete
- [ ] Keep `docs/SESSION.md` current as phases are completed
