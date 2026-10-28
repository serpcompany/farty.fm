# AGENTS

Routing only. Open the smallest source that matches the task.

Stage: ship

Agents may merge: listed paths

- `README.md`, `CONTEXT.md`
- `docs/**`, except `docs/adr/**` and `docs/agents/exceptions.md`
- `apps/web/docs/**`
- `apps/web/src/components/ui/**`
- `apps/web/src/components/farty/{compose-screen,download-qr,install-button,install-prompt,locked-song-sheet,note-view,pitch-strip,record-button,record-screen,recordings-screen,toot-screen,toots-screen,waveform,welcome}.tsx`
- `apps/web/public/**`, except `sw.js` and `_headers`

A PR merges by an agent only when every file it changes is on that list. The owner merges every other PR, and only the owner changes these lines ([Verification Cadence](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification-cadence.md)).

## Every change

- [`docs/agents/code.md`](docs/agents/code.md): the rules all code follows (no comments, a file size limit, no duplicate or dead code, imports that follow the layers, no secrets, a test for every fix, docs that stay true), the checks and hooks behind them, the skills, and when a change is done.
- [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md): issues, the roadmap, branches, pull requests, review and merging.

## Commands

- **Finish gate:** `pnpm check` from the root, once, on the finished tree.
- **The checks:** `pnpm verify`, or some checks on some paths: `pnpm verify comments,sizes <paths>`.
- **Inner loop, the web app:** from `apps/web`, `pnpm typecheck`, `pnpm lint` and `pnpm exec vitest related --run <files>`.
- **In the running app:** the [`verify-web`](.claude/skills/verify-web/SKILL.md) skill.

## Codebase

- [`ARCHITECTURE.md`](ARCHITECTURE.md): the parts, how the web app stays matched to the reference, how data moves, the layout and the layers.
- [`apps/web/AGENTS.md`](apps/web/AGENTS.md): the web app's commands and the evidence each change needs.
- [`docs/agents/web.md`](docs/agents/web.md): environments, data, hosts, deploys, the smoke test, tapping through, and where the web app differs from SERP's standards.
- [`docs/agents/accounts.md`](docs/agents/accounts.md), [`payments.md`](docs/agents/payments.md), [`staging-access.md`](docs/agents/staging-access.md) and [`releases.md`](docs/agents/releases.md): sign-in, paying to save a Toot, the Staging gate, and promotion, releases and who merges.
- [`docs/agents/web-gotchas.md`](docs/agents/web-gotchas.md): what building the web app taught.
- [`docs/agents/ci.md`](docs/agents/ci.md): every workflow, the checks a merge waits for, and the pinned actions.
- [`docs/agents/google-play.md`](docs/agents/google-play.md): the Play app, a Trusted Web Activity.
- [`tools/melody-lab/README.md`](tools/melody-lab/README.md): the reference engine the web app is matched to. Its answers are the [golden data](fixtures/golden/README.md).
- [`tools/catalog/README.md`](tools/catalog/README.md): importing Songs from PDMX, with their sources and licenses.
- [`docs/design/app-map.md`](docs/design/app-map.md) and [`docs/design/screens.md`](docs/design/screens.md): the screens and their states.
- [`docs/brand/README.md`](docs/brand/README.md): the logo and app icon.

## Decisions

- [`docs/adr/`](docs/adr/): decisions and why. Read only the relevant records.
- [`docs/agents/domain.md`](docs/agents/domain.md): the layout, the terms, and flagging a conflict with an ADR.
- [`CONTEXT.md`](CONTEXT.md): the glossary.

## Working rules

These rules come from a long first attempt that produced a lot of process and little working product.

1. **Show working results, not process.** Finish a slice until the product owner can hear or tap it. Don't ask them to judge anything a test or measurement can check.
2. **Verify the audio before claiming anything.** For rendering work, run the checks in `tools/melody-lab/evaluate.py` on the real output (`apps/web/scripts/render-songs.ts` renders the web app's Songs for `evaluate_renders.py`) and report the numbers. Never describe audio you haven't measured.
3. **Fart-only sound.** Rendering may only trim, cut, fade, adjust gain, and mix Recordings, and plays each fart at its own pitch and speed (ADR 0004, ADR 0012). The only resampling is sample-rate conversion. No oscillators, resonators, loops, or granular re-triggering.
4. **Songs need sources.** Never type melody notes by hand. Add Songs through `catalog/` with a cited score and license (ADR 0003).
5. **Match the reference.** `tools/melody-lab/` is the reference engine. When the web app's engine differs from it, either fix the web app or change the reference deliberately and re-verify it.
6. **Keep the UI simple.** Remove anything that isn't needed.
7. **Never read, type or print a secret.** Follow SERP's [Secret Authority](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-operations/secret-authority.md). Write a value you make yourself (a session or signing secret, or the secret of a webhook you register), or a one-project Cloudflare API token with the fewest permissions from the owner's keychain minter, straight to where it's read. Stripe's and every other dashboard's keys are the owner's to set from their own terminal.
8. **No App Store or TestFlight.** Never submit to either again. 1.0.0 was rejected under guidelines 4.3(b) and 1.1.1 (ADR 0007), and the owner said never to resubmit a fart app.
9. **Fixtures are internal.** The Fixture Library (`fixtures/recordings/`) never ships in regular-user builds.

## Where this differs from SERP's standards

SERP's [engineering standards](https://github.com/serpcompany/serp/tree/main/docs/engineering/standards) apply. Where one says otherwise, these win:

- **The web app's exceptions** (agents tap through on the local Workers build; errors and analytics are Cloudflare's own; no mockups) are in [`apps/web/AGENTS.md`](apps/web/AGENTS.md), with their detail in [`docs/agents/web.md`](docs/agents/web.md).
- **CI runs SERP's checks from the installed package,** not serp's reusable workflows and action, because this repository is public ([`docs/agents/ci.md`](docs/agents/ci.md)).

## Retired material

The iPhone app, its Swift Recording Analysis and its App Store submission are in the tag `archive-2026-10-27` (ADR 0013). Read a file with `git show archive-2026-10-27:<path>`.
