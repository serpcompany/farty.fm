# Critical Workflows: Fart Melody Accuracy

**Purpose:** Prevent false progress while tuning the audio engine

**Date:** 2026-03-21

---

## Accuracy Baseline First (Phase 1)

**STOP. Do not tune generation before a local baseline exists.**

**Context:** The repo already contains several "v2" improvements, so it is easy to change multiple things and lose track of what actually helped.

**Order matters:**
1. Repair local path/dependency issues so the backend scripts run in this workspace.
2. Run the quality harness on a fixed sample matrix.
3. Save the output scores and 3-5 listening notes.
4. Only then start changing sample analysis or generation logic.

**Why this order:** Without a baseline, every future "improvement" is just a guess.

**Common Mistake:** Tuning FFmpeg filters first because the output sounds bad.

**Fix if broken:** Revert to the last measured build, rerun the baseline matrix, then continue one change at a time.

---

## Analyzer Bake-Off Before Cache Changes (Phase 2)

**STOP. Do not rewrite the cache format until the analysis winner is chosen.**

**Context:** The current code treats spectral centroid like pitch. That may be directionally useful but is probably too weak to drive note matching by itself.

**Order matters:**
1. Pick a fixed evaluation set of bundled and user-recorded fart samples.
2. Compare the current approach to at least one stronger existing library/tool.
3. Score each approach for reference note usefulness, confidence, and failure behavior.
4. Choose one production approach.
5. Then update cache schema and API responses.

**Why this order:** Changing the cache first locks the team into a data shape before the measurement method is proven.

**Common Mistake:** Adding more custom heuristics to a weak detector instead of benchmarking a better tool.

**Fix if broken:** Freeze the schema, run the benchmark, and only then finalize the fields.

---

## Remove the Helper Tone in a Controlled Way (Phase 4)

**STOP. Do not remove the helper sine tone in the same commit as unrelated scoring changes.**

**Context:** The helper tone currently props up recognizability. Removing it is necessary, but doing it alongside multiple matching changes hides whether the core engine actually improved.

**Order matters:**
1. Capture the pre-removal baseline.
2. Remove the helper tone.
3. Re-run the same matrix immediately.
4. Only after that, tune note assignment or fallback rules.

**Why this order:** It isolates whether the engine can stand on its own without artificial pitch support.

**Common Mistake:** Removing the tone and changing sample assignment logic at the same time.

**Fix if broken:** Split the changes, rerun the matrix, and compare the two results directly.

---

## Explain Fit Before Generation (Phase 5)

**STOP. Do not expose recorded-sample generation without a fit warning path.**

**Context:** User-recorded farts vary wildly. Some will not support certain melodies even after transpose.

**Order matters:**
1. Analyze the selected samples.
2. Score the melody fit.
3. Show recommendation/warning copy in the Create screen.
4. Let the user generate anyway if they want.

**Why this order:** It avoids the app feeling random or broken when a bad sample set produces a weak song.

**Common Mistake:** Treating all selected samples as equally capable and only surfacing failure after generation.

**Fix if broken:** Add preflight fit messaging and include the top risks in the response payload.

---

## Quick Checklist

- [ ] Phase 1: Baseline captured before tuning
- [ ] Phase 2: Analyzer benchmark completed before cache schema changes
- [ ] Phase 4: Helper tone removal measured independently
- [ ] Phase 5: Fit explanation shown before generate

---

## References

- `docs/IMPLEMENTATION_PHASES.md`
- `docs/TESTING.md`
- `docs/knowledge/fart-song-accuracy-baseline.md`
