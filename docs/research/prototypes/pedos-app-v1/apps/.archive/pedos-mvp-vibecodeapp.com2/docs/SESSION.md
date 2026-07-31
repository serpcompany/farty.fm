# Session State

**Current Phase**: Phase 1
**Current Stage**: Baseline, paths, and diagnostics
**Last Checkpoint**: 2026-03-21 fallback renderer enabled, mobile Create screen now resolves the local backend automatically in Expo dev, and the helper sine tone has been removed from generation and quality-harness rendering
**Planning Docs**: `docs/IMPLEMENTATION_PHASES.md`, `docs/CRITICAL_WORKFLOWS.md`, `docs/TESTING.md`

---

## Phase 0: Planning ✅
**Completed**: 2026-03-21
**Summary**: Reframed the problem from "missing MIDI support" to "weak sample profiling + weak song-fit logic"
**Deliverables**:
- `docs/IMPLEMENTATION_PHASES.md`
- `docs/CRITICAL_WORKFLOWS.md`
- `docs/TESTING.md`
- `docs/knowledge/fart-song-accuracy-baseline.md`

## Phase 1: Baseline, Paths, and Diagnostics ⏸️
**Spec**: `docs/IMPLEMENTATION_PHASES.md#phase-1-baseline-paths-and-diagnostics`
**Type**: Infrastructure
**Time**: 3 hours
**Progress**: In progress
**Next Action**: Verify the actual iPhone Create tab against the live local backend and then retune note matching because removing the helper tone exposed the raw fart-only accuracy drop

## Phase 2: Sample Analysis v2 ⏸️
**Spec**: `docs/IMPLEMENTATION_PHASES.md#phase-2-sample-analysis-v2`
**Type**: API
**Time**: 4 hours
**Progress**: Not started

## Phase 3: Melody Fit Scoring and Recommendations ⏸️
**Spec**: `docs/IMPLEMENTATION_PHASES.md#phase-3-melody-fit-scoring-and-recommendations`
**Type**: API
**Time**: 3 hours
**Progress**: Not started

## Phase 4: Generation Engine v3 ⏸️
**Spec**: `docs/IMPLEMENTATION_PHASES.md#phase-4-generation-engine-v3`
**Type**: API
**Time**: 4 hours
**Progress**: Not started

## Phase 5: Recorded Fart Support and Explainability ⏸️
**Spec**: `docs/IMPLEMENTATION_PHASES.md#phase-5-recorded-fart-support-and-explainability`
**Type**: Integration
**Time**: 3 hours
**Progress**: Not started

## Phase 6: Acceptance Tuning and Release Readiness ⏸️
**Spec**: `docs/IMPLEMENTATION_PHASES.md#phase-6-acceptance-tuning-and-release-readiness`
**Type**: Testing
**Time**: 3 hours
**Progress**: Not started

---

## Critical Reminders

**Before Starting:**
- [ ] Read `docs/CRITICAL_WORKFLOWS.md`
- [ ] Read `docs/TESTING.md`
- [ ] Capture a measurable baseline before tuning the engine

**Critical Workflows:**
- Baseline first
- Analyzer bake-off before cache changes
- Remove helper tone in isolation
- Explain fit before generation

---

## Known Risks

**High-Risk Phases:**
- Phase 2: Sample Analysis v2 - single fart samples may be too noisy for reliable pitch confidence without a better library/tool
- Phase 4: Generation Engine v3 - removing the helper tone may expose weak note matching immediately
- Phase 5: Recorded Fart Support and Explainability - network/upload behavior can make the flow feel broken if preflight messaging is weak

**Mitigation:** Measure every change, keep fallbacks explicit, and document poor-fit cases instead of pretending all sample sets should work.

---

**Status Legend**: ⏸️ Pending | 🔄 In Progress | ✅ Complete | 🚫 Blocked | ⚠️ Issues
