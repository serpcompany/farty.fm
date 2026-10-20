# Pedos web app

The Pedos web app (ADR 0007). Read the repository's `AGENTS.md` first: its working rules apply here.

Environments, deploys and CI: read the working guide, [`docs/agents/web.md`](../../docs/agents/web.md).

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
| `pnpm deploy:staging` | Build and deploy the `pedos-web-staging` Worker, for a person in an emergency. CI deploys Staging on every push to `staging` (`web-deploy.yml`). |
| `scripts/smoke.sh <url> <staging\|production>` | The post-deploy smoke test |

## Layout

- `src/lib/analysis/`: Recording Analysis, ported from `RecordingAnalysisKit`. Plain TypeScript with no DOM or Web Audio, so it runs in the Web Worker (`worker.ts`) and in Vitest alike.
- `src/lib/audio/`: the microphone (an AudioWorklet, with the browser's voice processing off) and playback.
- `src/lib/recording-store.ts`: Recordings in IndexedDB. Nothing leaves the browser.
- `src/components/pedos/`: the screens, matching the iPhone app's. `src/components/ui/` stays stock shadcn.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
