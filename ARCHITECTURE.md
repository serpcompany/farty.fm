# Architecture

The repository's parts, how data moves between them, and the layers the web app keeps. Terms are as [CONTEXT.md](CONTEXT.md) defines them.

## The parts

| Part | What it is |
| --- | --- |
| `apps/web/` | Farty: a Next.js app on Cloudflare Workers, installable from the browser. Each environment has its own Worker, D1 database and R2 bucket ([the web app guide](docs/agents/web.md)). |
| `tools/melody-lab/` | The reference engine, in Python: Recording Analysis, Auto-map and the fart-only renderer, as approved by ear. |
| `fixtures/golden/` | The reference engine's answers for the Fixture Library and the Song Catalog. They are the contract between the reference and the web app. |
| `fixtures/recordings/` | The Fixture Library: real Recordings, with their licenses, for tests and tools. It never ships to Production. |
| `catalog/` | The Song Catalog's cited public-domain scores, imported by `tools/catalog/`. |

## How the web app stays matched to the reference

`tools/melody-lab/export_golden.py` writes the reference's answers to `fixtures/golden/`. The web app's unit tests run its own Recording Analysis and engine on the same Recordings and Songs and compare: Recording Pitch must be bit-identical, which is why `src/lib/analysis/numeric.ts` rounds `exp2` and `log2` as numpy does. `src/lib/catalog/generate.ts` writes the Songs the app ships (`songs.generated.ts`) from the golden copy of each score, so no melody is typed by hand. A change to the reference changes the golden data in the same commit, and the web app follows it.

The renders are checked the other way round: `apps/web/scripts/render-songs.ts [out-dir]` renders every Song through the web engine with the full Fixture Library, into the melody lab's git-ignored output folder by default. For each Song it writes the renderer's exact output as a 32-bit float WAV and its notes as JSON, for `tools/melody-lab/evaluate_renders.py` to measure. It fails when a Song that the golden Arrangement unlocks comes out locked.

## How data moves in the web app

1. **Recording:** the microphone feeds an AudioWorklet (`src/lib/audio/`) with the browser's voice processing off. Saving writes the Recording to IndexedDB at once; nothing waits on analysis.
2. **Recording Analysis** runs in a Web Worker (`src/lib/analysis/`) and is kept with the Recording.
3. **Compose and Song Creator:** Pitch Coverage decides which Songs are unlocked. Auto-map chooses the Arrangement, and the renderer plays it with the Recordings, in its own Web Worker (`src/lib/engine/`). A saved result is a Toot.
4. **An account** (optional) syncs the library: each save, rename and delete waits in an outbox with the change itself, and the sync sends it to the API (`src/app/api/`, `src/server/`), which keeps Recordings and Toots in D1 and their audio in R2. Saving a Toot is paid through Stripe Checkout ([Payments](docs/agents/payments.md)).

## Offline: the service worker

`public/sw.js` keeps the app shell so an installed Farty opens offline.

- **Network first.** Every same-origin GET it handles goes to the network, so a deploy shows at once. The kept copy answers only offline, or when a deploy has removed an older build's `/_next/static/` file that a tab opened before the deploy still loads (#222). A build's files never change under the same name.
- **What it keeps:** pages, scripts, styles, fonts and images, only from a whole same-origin 200 (never a redirect, an error or Staging's 401), up to 200 files, oldest first. It never keeps audio (Recordings live in IndexedDB), the Fixture Library (`/fixtures/`, internal only), or the lander's images (`/lander/`, desktop only, #191).
- **The whole shell, ahead of time:** each online load of the start page (`/`), at most every five minutes, fetches the tabs it links to, each Song's page from `/shell.json`, and the scripts they load, including the Web Workers' own chunks. Every tab then opens offline right after install, even one never visited. A load that loses the connection part way tries again on the next start page.
- **Staging's password:** a navigation answered with Staging's 401 unregisters the worker, since a browser won't ask for credentials on a worker's behalf. The next load asks for the password and registers it again.
- **Versions:** the cache is `pedos-shell-v<version>`. Raise `version` when its contents change shape; a new worker deletes every other version's cache when it activates.

## The web app's layout

- `src/lib/analysis/`: Recording Analysis, matched to the reference through `fixtures/golden/`. Plain TypeScript with no DOM or Web Audio, so it runs in the Web Worker (`worker.ts`) and in Vitest alike.
- `src/lib/engine/`: Auto-map and the fart-only renderer, matched to the reference. Plain TypeScript, so it renders in its Web Worker (`worker.ts`) and in Vitest alike. `pnpm exec tsx scripts/render-songs.ts` renders every Song for `tools/melody-lab/evaluate_renders.py`.
- `src/lib/audio/`: the microphone (an AudioWorklet, with the browser's voice processing off) and playback.
- `src/lib/recording-store.ts`: the `pedos` IndexedDB database, with Recordings (`recording-store.ts`) and Toots (`toot-store.ts`), this browser's working copy. A guest keeps their Recordings, and their Toots last only the visit (owner, 2026-10-25, #203): each open reads the session, and a guest's new visit clears the last one's Toots (`visit.ts`).
- `src/lib/library-sync.ts`, `outbox.ts`, `library-api.ts`: a signed-in browser's sync with the account (#156). Each save, rename and delete queues in the outbox with the change itself; the sync uploads it and reads the account's changes since its last read. `pedos.account` names the account the library is, and every library request names it (`x-pedos-library`), so a library never reads from, uploads to or deletes in another.
- `src/lib/account.ts`, `src/components/pedos/account-provider.tsx`, `account-step.tsx`: the account from the browser (the sign-in API and `/api/account/`), and the account step after the first Result (#155).
- `src/lib/toot.ts`, `toot-renderer.ts`: a Toot, a Song rendered with the user's Recordings in the render worker, as Song Creator makes it.
- `src/lib/pricing.ts`, `toot-payment.ts`, `src/server/stripe.ts`, `toot-payments.ts`, `src/db/payments.ts`: paying $0.99 to save a Toot (ADR 0010, #204), through Stripe Checkout, or the dev checkout (`/dev/checkout/`) on a local run ([Payments](docs/agents/payments.md)).
- `src/lib/security-headers.ts`: the headers every response carries, which `next.config.ts` sends with pages and `public/_headers` with the static files Production serves without the Worker.
- `src/db/`: the D1 schema (Better Auth's tables, `recordings`, `toots` and `toot_payments`), `createDatabase()` over any D1 binding (`database.ts`, importable from tests) and `getDb()` for a request (`index.ts`, server-only), through Drizzle. Migrations are in `drizzle/`.
- `src/app/api/`, `src/server/`: a signed-in user's library (Recordings, Toots and their WAVs in R2) and account. Every route outside `api/auth/`, `api/telemetry/` and `api/stripe/webhook/` is built with `userRoute` (`require-user.ts`): session, then `Origin` on writes, `private, no-store`. `every-route.workers.test.ts` fails a route that skips it.
- `src/lib/telemetry/`, `src/app/api/telemetry/`: error reports (`reportError(code, error)`, a stable code and an allowlist, logged by the route), the app's only telemetry, off with Profile's switch or Global Privacy Control (#126). `/dev/telemetry/` sends a synthetic crash and handled error, except in Production.
- `src/server/`: sign-in (#152), server-only behind `auth.ts`: Better Auth email codes (`auth-config.ts`), email and the dev mailbox (`email.ts`, `dev-mailbox.ts`, `/dev/mail/`) ([Accounts and sign-in](docs/agents/accounts.md)).
- `src/components/pedos/`: the screens. `src/components/ui/` stays stock shadcn.
- `worker.ts`: the Worker's entry, which answers the host redirects and the Staging gate before Next.js sees a request.

## Layers

Imports point inward, and each rule says what enforces it:

| Rule | Enforced by |
| --- | --- |
| `src/lib` holds the app's logic and never imports components, hooks or routes | Biome's `noRestrictedImports` in `apps/web/biome.json` |
| Components and hooks never import routes (`src/app`) | The same |
| Server code (`src/server`, `src/db/index.ts`) never reaches the browser | `import 'server-only'` in each entry |
| Production code imports no test or test support, and no devDependency | The dependency check (`verify.json`, the `apps/web` part) |
| No import cycles, and every module is reachable from an entry point | The same |
| `src/lib/analysis` and `src/lib/engine` use no DOM or Web Audio, so they run in a Web Worker and in Vitest | Convention for now, checked when their Workers and tests run |
