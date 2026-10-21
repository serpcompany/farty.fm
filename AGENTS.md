Stage: ship
Release PRs: until #122 ends, agents may merge every PR for the web MVP (#106): work PRs, launch fixes, the launch release PR, the `main` → `staging` merge-back, and the PR that removes this line (owner, 2026-10-21, #113 comment 6303110568). Only the owner changes this line.

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. The build order is the pinned **Web MVP** roadmap issue (#106). Pick the next issue and follow the git workflow as described in `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## Working rules

These rules come from a long first attempt that produced a lot of process and little working product.

- **Show working results, not process.** Finish a slice until the product owner can hear or tap it. Don't ask them to judge anything a test or measurement can check.
- **Verify the audio before claiming anything.** For rendering work, run the checks in `tools/melody-lab/evaluate.py` (or their Swift equivalents) on the real output and report the numbers. Never describe audio you haven't measured.
- **Fart-only sound.** Rendering may only trim, resample, fade, adjust gain, and mix Recordings (ADR 0004). No oscillators, resonators, loops, or granular re-triggering.
- **Songs need sources.** Never type melody notes by hand. Add Songs through `catalog/` with a cited score and license (ADR 0003).
- **Match the reference.** `tools/melody-lab/` is the reference engine. When Swift behavior differs from it, either fix the Swift code or change the reference deliberately and re-verify it.
- **Keep the UI simple.** Remove anything that isn't needed.
- **Fixtures are internal.** The Fixture Library (`fixtures/recordings/`) never ships in regular-user builds.
