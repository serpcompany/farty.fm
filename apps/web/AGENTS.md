# Pedos web app

The Pedos web app (ADR 0007). Read the repository's `AGENTS.md` first: its working rules apply here.

**Design.** The iPhone app is the approved design. No mockup round. Where `docs/design/` or an ADR differs from the Swift code, the Swift code wins.

**Before you touch environments, deploys, the Staging gate, CI or the e2e setup, read [`docs/agents/web.md`](../../docs/agents/web.md).** It holds the environment table, how Staging deploys, the password gate, how to run the Workers build locally, the detail behind each exception below, and the gotchas learned in slice 1.

## Commands

Run from `apps/web/`:

| Command | Runs |
| --- | --- |
| `pnpm dev` | The app at http://localhost:3000 |
| `pnpm test` | Unit tests, including Recording Analysis against `fixtures/golden/` |
| `pnpm test:e2e` | Record journeys in Chromium with a fixture as a fake microphone |
| `pnpm lint`, `pnpm typecheck` | Biome, then TypeScript |
| `pnpm check` | The finish gate: lint, types, tests and build. It never writes files. |
| `pnpm build:staging`, `pnpm build:production` | The Workers build for one environment, into `.open-next/` |
| `pnpm deploy:staging` | Build and deploy the `pedos-web-staging` Worker, for a person in an emergency. Agents never run it. CI deploys Staging on every push to `staging` (`web-deploy.yml`). |
| `scripts/smoke.sh <url> <staging\|production>` | The post-deploy smoke test |

## Layout

- `src/lib/analysis/`: Recording Analysis, ported from `RecordingAnalysisKit`. Plain TypeScript with no DOM or Web Audio, so it runs in the Web Worker (`worker.ts`) and in Vitest alike.
- `src/lib/engine/`: Auto-map and the fart-only renderer, ported from `AutoMap.swift` and `Renderer.swift` and matched to the reference. Plain TypeScript, so it renders in its Web Worker (`worker.ts`) and in Vitest alike. `pnpm exec tsx scripts/render-songs.ts` renders every Song for `tools/melody-lab/evaluate_renders.py`.
- `src/lib/audio/`: the microphone (an AudioWorklet, with the browser's voice processing off) and playback.
- `src/lib/recording-store.ts`: Recordings in IndexedDB. Nothing leaves the browser.
- `src/components/pedos/`: the screens, matching the iPhone app's. `src/components/ui/` stays stock shadcn.

## Where this differs from SERP's standards

SERP's [web stack](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/web-stack/README.md) is the default. These are the exceptions, with detail in [`docs/agents/web.md`](../../docs/agents/web.md#exceptions-to-serps-standards):

- **CI checks are off until #113.** Authors run `pnpm check` on the PR's head and cite it ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
- **Agents tap through, on the local Workers build,** not on a PR preview or by the owner. Before launch, agents merge every PR once a fresh review has no open blocking finding and the cited check is green ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
- **Hosts.** Staging stays on `*.workers.dev` until #113 ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
- **Errors and analytics, until #126.** No Sentry, GTM or analytics at launch ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
- **No mockups.** See Design, above.

## Evidence

What a PR shows, by kind of change (see [Verification cadence](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification-cadence.md)). The commands are in the table above, and the [`verify-pedos-web`](../../.claude/skills/verify-pedos-web/SKILL.md) skill runs them end to end.

- **Preview evidence** (any user-visible change): the author's tap-through on the local Workers build behind the Staging gate, at phone size.
- **UI evidence:** the Playwright journeys (`pnpm test:e2e`, with `E2E_SERVER=preview` on the Workers build) and phone-size screenshots.
- **Device evidence:** the owner's phone, for the microphone, audio and install. Agents can't prove these, so a PR that changes them says so and doesn't claim them.
- **Deploy evidence:** `scripts/smoke.sh` against the running build, and against Staging after CI deploys it.
- **Finish gate:** `pnpm check` on the PR's head commit.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
