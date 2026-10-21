# Pedos web app

The Pedos web app (ADR 0007). Read the repository's `AGENTS.md` first: its working rules apply here.

**Design.** The iPhone app is the approved design. No mockup round. Where `docs/design/` or an ADR differs from the Swift code, the Swift code wins.

**Before you touch environments, deploys, the Staging gate, CI or the e2e setup, read [`docs/agents/web.md`](../../docs/agents/web.md).** It holds the environment table, how each environment deploys, promotion and releases, the password gate, how to run the Workers build locally, the detail behind each exception below, and the gotchas learned in slice 1.

## Commands

Run from `apps/web/`:

| Command | Runs |
| --- | --- |
| `pnpm dev` | The app at http://localhost:3000 |
| `pnpm test` | Unit tests, including Recording Analysis against `fixtures/golden/`, and the API routes in workerd with a real D1 and R2 (`*.workers.test.ts`) |
| `pnpm test:e2e` | Record journeys in Chromium with a fixture as a fake microphone |
| `pnpm lint`, `pnpm typecheck` | Biome, then TypeScript |
| `pnpm check` | The finish gate: lint, types (including `wrangler types --check` on `cloudflare-env.d.ts`), `drizzle-kit check`, tests and build. It never writes files. |
| `pnpm db:generate` | Write a migration into `drizzle/` after a change to `src/db/schema.ts` |
| `pnpm db:migrate:local` | Apply the migrations to the local D1 in `.wrangler/`. CI applies Staging's and Production's (`db:migrate:<env>`) before each deploy; agents never run those. |
| `pnpm build:staging`, `pnpm build:production` | The Workers build for one environment, into `.open-next/` |
| `pnpm deploy:staging`, `pnpm deploy:production` | Build and deploy that environment's Worker, for a person in an emergency. Agents never run them. CI deploys Staging on every push to `staging`, and Production on every push to `main`, once the checks pass (`web.yml`). |
| `scripts/smoke.sh <url> <staging\|production>` | The post-deploy smoke test, also run against a local preview |

## Layout

- `src/lib/analysis/`: Recording Analysis, ported from `RecordingAnalysisKit`. Plain TypeScript with no DOM or Web Audio, so it runs in the Web Worker (`worker.ts`) and in Vitest alike.
- `src/lib/engine/`: Auto-map and the fart-only renderer, ported from `AutoMap.swift` and `Renderer.swift` and matched to the reference. Plain TypeScript, so it renders in its Web Worker (`worker.ts`) and in Vitest alike. `pnpm exec tsx scripts/render-songs.ts` renders every Song for `tools/melody-lab/evaluate_renders.py`.
- `src/lib/audio/`: the microphone (an AudioWorklet, with the browser's voice processing off) and playback.
- `src/lib/recording-store.ts`: the `pedos` IndexedDB database, with Recordings (`recording-store.ts`) and Toots (`toot-store.ts`). Nothing leaves the browser.
- `src/lib/toot.ts`, `toot-renderer.ts`: a Toot, a Song rendered with the user's Recordings in the render worker, as Song Creator makes it.
- `src/db/`: the D1 schema (Better Auth's tables, `recordings` and `toots`), `createDatabase()` over any D1 binding (`database.ts`, importable from tests) and `getDb()` for a request (`index.ts`, server-only), through Drizzle. Migrations are in `drizzle/`.
- `src/app/api/`, `src/server/`: a signed-in user's library (Recordings, Toots and their WAVs in R2) and account. Every route outside `api/auth/` is built with `userRoute` (`require-user.ts`): session, then `Origin` on writes, `private, no-store`. `every-route.workers.test.ts` fails a route that skips it.
- `src/server/`: sign-in (#152), server-only behind `auth.ts`: Better Auth email codes (`auth-config.ts`), email and the dev mailbox (`email.ts`, `dev-mailbox.ts`, `/dev/mail/`). How it works and where it runs is in [`docs/agents/web.md`](../../docs/agents/web.md#environments-and-deploys).
- `src/components/pedos/`: the screens, matching the iPhone app's. `src/components/ui/` stays stock shadcn.

## Where this differs from SERP's standards

SERP's [web stack](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/web-stack/README.md) is the default. These are the exceptions, with detail in [`docs/agents/web.md`](../../docs/agents/web.md#exceptions-to-serps-standards):

- **Agents tap through, on the local Workers build,** not on a PR preview or by the owner. Before launch, agents merge every PR once a fresh review has no open blocking finding and the cited check is green ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
- **Errors and analytics, until #126.** No Sentry, GTM or analytics at launch ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
- **No mockups.** See Design, above.

## Evidence

What a PR shows, by kind of change (see [Verification cadence](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification-cadence.md)). The commands are in the table above, and the [`verify-pedos-web`](../../.claude/skills/verify-pedos-web/SKILL.md) skill runs them end to end.

- **Preview evidence** (any user-visible change): the author's tap-through on the local Workers build behind the Staging gate, at phone size.
- **UI evidence:** the Playwright journeys (`pnpm test:e2e`, with `E2E_SERVER=preview` on the Workers build) and phone-size screenshots.
- **Device evidence:** the owner's phone, for the microphone, audio and install. Agents can't prove these, so a PR that changes them says so and doesn't claim them.
- **Deploy evidence:** `scripts/smoke.sh` against the running build, and against each environment after CI deploys it.
- **Finish gate:** `pnpm check` on the PR's head commit, cited in the PR, and `web.yml`'s required checks on it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
