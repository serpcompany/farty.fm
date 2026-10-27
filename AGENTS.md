Stage: ship

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. The build order is the pinned **Web MVP** roadmap issue (#106). Pick the next issue and follow the git workflow as described in `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## Working rules

These rules come from a long first attempt that produced a lot of process and little working product.

- **Show working results, not process.** Finish a slice until the product owner can hear or tap it. Don't ask them to judge anything a test or measurement can check.
- **Verify the audio before claiming anything.** For rendering work, run the checks in `tools/melody-lab/evaluate.py` (or their Swift equivalents) on the real output and report the numbers. Never describe audio you haven't measured.
- **Fart-only sound.** Rendering may only trim, cut, fade, adjust gain, and mix Recordings, and plays each fart at its own pitch and speed (ADR 0004, ADR 0012). The only resampling is sample-rate conversion. No oscillators, resonators, loops, or granular re-triggering.
- **Songs need sources.** Never type melody notes by hand. Add Songs through `catalog/` with a cited score and license (ADR 0003).
- **Match the reference.** `tools/melody-lab/` is the reference engine. When Swift behavior differs from it, either fix the Swift code or change the reference deliberately and re-verify it.
- **Keep the UI simple.** Remove anything that isn't needed.
- **The owner is not a blocker (before the MVP).** See Who merges in `docs/agents/web.md`.
- **Never read, type or print a secret.** Follow SERP's [Secret Authority](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-operations/secret-authority.md). Write a value you make, or a Cloudflare API token from the owner's keychain minter, straight to where it's read. Stripe's and every other dashboard's keys are the owner's to set from their own terminal.
- **No App Store or TestFlight.** Never submit to either again. 1.0.0 was rejected under guidelines 4.3(b) and 1.1.1 (ADR 0007), and the owner said never to resubmit a fart app.
- **Fixtures are internal.** The Fixture Library (`fixtures/recordings/`) never ships in regular-user builds.
