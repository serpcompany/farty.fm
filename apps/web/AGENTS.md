# Farty web app

The Farty web app (ADR 0007). Read the repository's `AGENTS.md` first: its working rules apply here.

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
- `src/lib/recording-store.ts`: the `pedos` IndexedDB database, with Recordings (`recording-store.ts`) and Toots (`toot-store.ts`), this browser's working copy. A guest's farts last only the visit (ADR 0013, #237; on 2026-10-28 this replaced #203's rule that a guest keeps their Recordings): each open reads the session, and a guest's new visit clears the last one's Recordings and Toots, except the Recordings the browser held before #237 (`visit.ts`).
- `src/lib/library-sync.ts`, `outbox.ts`, `library-api.ts`: a signed-in browser's sync with the account (#156). Each save, rename, placement by ear and delete queues in the outbox with the change itself; the sync uploads it and reads the account's changes since its last read. `pedos.account` names the account the library is, and every library request names it (`x-pedos-library`), so a library never reads from, uploads to or deletes in another.
- `src/lib/account.ts`, `src/components/pedos/account-provider.tsx`, `account-step.tsx`: the account from the browser (the sign-in API and `/api/account/`), and the account step after the first Result (#155), with Turnstile on sending a code (`turnstile.tsx`, #237).
- `src/lib/pads.ts`, `pad-store.ts`, `audio/pad-player.ts`: the Sound Pad (#277). Which Recording each Pad plays, kept in the `pedos` database's `pads` store (this browser's only, never synced), and a player that decodes each Pad's sound ahead, trims it in the render worker from where a Song starts the fart (#298), and starts a buffer of its own per tap.
- `src/lib/favorite-store.ts`, `src/components/pedos/favorite-button.tsx`: Favorite Songs (#313), a heart on each Song in Compose, its locked-Song sheet and Song Creator. Kept in the `pedos` database's `favorites` store for guests too, and synced with the account like a Recording, by Song id (`/api/favorites/{songId}/`). `compose-choices.ts` keeps Compose's sort and its Kind and Show filters (#384, #397) in `localStorage`.
- `src/lib/engine/fart-choices.ts`, `fart-choice-store.ts`, `fart-sheet.ts`, `src/components/pedos/use-fart-choices.ts`, `fart-sheet.tsx`: Fart Choices (#360), a Song's swapped and left-out farts, changed from a note in Song Creator through its fart sheet. Arranged as the reference's `engine.py` arranges them (`fixtures/golden/choices.json`), kept in the `pedos` database's `fartChoices` store and synced with the account like a Favorite Song (`/api/fart-choices/{songId}/`).
- `src/lib/performance.ts`, `pad-take.ts`, `engine/render-performance.ts`, `src/components/pedos/pad-take.tsx`: the Sound Pad's Record (#278, ADR 0017). A take's taps as a compact Performance, kept in `localStorage` across Checkout, rendered in the render worker with each tap's fart raw from its start, and saved as a Toot.
- `src/lib/toot.ts`, `toot-renderer.ts`: a Toot, made in the render worker: a Song rendered with the user's Recordings, as Song Creator makes it, or a Sound Pad Performance (`makePadToot`, ADR 0017).
- `src/lib/pricing.ts`, `toot-payment.ts`, `src/server/stripe.ts`, `toot-payments.ts`, `src/db/payments.ts`: paying $0.99 to save a Toot (ADR 0010, #204), through Stripe Checkout, or the dev checkout (`/dev/checkout/`) on a local run. [`docs/agents/web.md`](../../docs/agents/web.md#environments-and-deploys) has how it works and Stripe's setup.
- `src/db/`: the D1 schema (Better Auth's tables, `recordings`, `toots`, `toot_payments`, `favorite_songs`, `fart_choices`, sharing's `handles`, `shares` and `share_reports`, `song_reports`, and `step_counts`), `createDatabase()` over any D1 binding (`database.ts`, importable from tests) and `getDb()` for a request (`index.ts`, server-only), through Drizzle. Migrations are in `drizzle/`.
- `src/app/api/`, `src/server/`: a signed-in user's library (Recordings, Toots and their WAVs in R2) and account. Every route outside `api/auth/`, `api/telemetry/`, `api/steps/`, `api/stripe/webhook/` and `api/songs/<id>/report/` is built with `userRoute` (`require-user.ts`): session, then `Origin` on writes, `private, no-store`. `every-route.workers.test.ts` fails a route that skips it.
- `src/server/sharing.ts`, `src/db/sharing.ts`, `src/app/[atHandle]/`, `src/components/pedos/share-recording.tsx`, `shared-recording-page.tsx`: sharing by unlisted link (#316, ADR 0020). The owner's Handle and shares under `api/handle/` and `api/share/` (`userRoute`), and the public page, link image (`image/`), audio and Report under `[atHandle]/r/[id]/` (a Recording) and `[atHandle]/t/[id]/` (a saved Toot, #317), outside `api/`, which find the item only through a live share in D1 on every request. `link-preview.tsx` draws both link images. Reports and take-downs are in [`docs/agents/web.md`](../../docs/agents/web.md#reports-and-take-downs).
- `src/server/friends.ts`, `profiles.ts`, `src/db/friends.ts`, `profiles.ts`, `src/lib/friends.ts`, `src/components/pedos/friends.tsx`, `profile-page.tsx`: Friends and profile pages (#319, ADR 0021), with D1's `friend_requests`, `friends` and `profile_reports`. Requests, the lists and each friendship under `api/friends/` (`userRoute`), Friends in Profile, and the public profile page and its Report under `[atHandle]/`, which lists only live shares, read from D1 on every request.
- `src/lib/get-farty.ts`, `src/components/pedos/get-farty.tsx`, `src/app/[atHandle]/layout.tsx`: Get Farty on a shared or profile page (#318). On a phone, the account step offers whoever's page it is as a friend, ticked, and sends the request only once they sign in there; then the Home Screen steps. Its stage is kept in `sessionStorage`, so a reload from Mail carries on, and it ends on any other page. On a computer, the lander's QR code.
- `src/lib/song-report.ts`, `src/server/song-reports.ts`, `src/db/song-reports.ts`, `src/components/pedos/report-song-sheet.tsx`: Report a problem with a Song (#358), at Song Creator's end and on a locked Song's sheet, guests' too. `POST /api/songs/<id>/report/` keeps a `song_reports` row with nothing about who sent it, within share Reports' limits in rows of their own; `tools/catalog/song_reports.py` lists an export worst first ([`docs/agents/web.md`](../../docs/agents/web.md#reports-and-take-downs)).
- `src/lib/telemetry/`, `src/app/api/telemetry/`, `api/steps/`, `src/db/step-counts.ts`: error reports (`reportError(code, error)`, a stable code and an allowlist, logged by the route, #126) and the funnel's daily step counts (`reachStep(step)`, D1's `step_counts`, #405), both off with Profile's switch or Global Privacy Control. `/dev/telemetry/` sends a synthetic crash and handled error, except in Production.
- `src/server/`: sign-in (#152), server-only behind `auth.ts`: Better Auth email codes (`auth-config.ts`), email and the dev mailbox (`email.ts`, `dev-mailbox.ts`, `/dev/mail/`). How it works and where it runs is in [`docs/agents/web.md`](../../docs/agents/web.md#environments-and-deploys).
- `src/components/pedos/`: the screens, matching the iPhone app's. `src/components/ui/` stays stock shadcn.

## Where this differs from SERP's standards

SERP's [web stack](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/web-stack/README.md) is the default. These are the exceptions, with detail in [`docs/agents/web.md`](../../docs/agents/web.md#exceptions-to-serps-standards):

- **Agents tap through, on the local Workers build,** not on a PR preview or by the owner. Before launch they also merge every PR (Who merges, in [`docs/agents/web.md`](../../docs/agents/web.md#promotion-and-releases)).
- **Errors and analytics are Cloudflare's own (#126).** No Sentry and no GTM: error reports go to the Worker's logs, and analytics come from Cloudflare's automatic Web Analytics on the zone, which the app doesn't load ([detail](../../docs/agents/web.md#exceptions-to-serps-standards)).
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
