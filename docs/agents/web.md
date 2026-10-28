# Web app: working guide

How `apps/web` is built, deployed and checked. Its commands are in `apps/web/AGENTS.md`.

## Environments and deploys

- **Branches.** `staging` is the base and default branch: every branch starts from it, and every PR goes into it. `main` is Production. It changes only by promotion from `staging` and by its release PR ([Promotion and releases](releases.md)), never by a PR from a work branch.
- **Environments.** One Worker per deployed environment, set under `env` in `apps/web/wrangler.jsonc`. Its top level is local-only and never deployed. Each build bakes in `SITE_ENV`, so a build serves only the environment it was built for.

  | Environment | Worker | URL | Build |
  | --- | --- | --- | --- |
  | Local | none | http://localhost:3000 (`pnpm dev`) | `pnpm build`, inside `pnpm check` |
  | Staging | `pedos-web-staging` | https://staging.farty.fm | `pnpm build:staging` |
  | Production | `pedos-web-production` | https://farty.fm | `pnpm build:production` |

- **Data (#150).** Each deployed environment binds its own D1 as `DB` and its own R2 bucket as `MEDIA`, both named `pedos-staging` or `pedos-production`, in the SERP Cloudflare account. The top level binds `pedos-local` (database id `local-only-do-not-deploy`), kept in `.wrangler/`, and the dev mailbox KV `DEV_MAILBOX`, which no deployed environment has. Drizzle owns every table, Better Auth's too (`src/db/schema.ts`). `pnpm db:generate` writes each change's migration into `drizzle/`, and `pnpm db:migrate:local` applies them locally. Remote databases change only through CI, never from an agent's machine. `src/db/deploy-config.test.ts` fails if `DEV_MAILBOX` reaches a deployed environment, a deploy or remote migration lacks `--env`, or an environment's hosts, `BETTER_AUTH_URL` or sender disagree with `site.ts` and `SUPPORT_EMAIL`.
- **Branded hosts.** Each environment's host is a custom domain in its `routes` in `wrangler.jsonc`, and Production also takes `www.farty.fm`. The Worker entry (`apps/web/worker.ts`, with `src/lib/other-hosts.ts`) answers `www.farty.fm` with a 308 to `https://farty.fm`, and each Worker's `*.workers.dev` host with a 308 to its environment's host. Each is one hop that keeps the path (in Next's trailing-slash form) and the query. A workers.dev request with the `x-pedos-smoke-test` header is served instead, so CI's smoke test reaches the Worker even when Bot Fight Mode challenges the branded host. Production serves static files without the Worker (it doesn't set `run_worker_first`), so a static file on `www` or workers.dev is served there rather than redirected. Every environment sets `workers_dev: true` and `preview_urls: false`, so no preview URLs exist. The hosts from before the rename answer with a 301 to these from a redirect rule on their own Cloudflare zone, outside the Worker (ADR 0009).
- **Canonicals, robots and sitemaps** name each environment's own host, from `src/lib/site.ts`. The layout sets `metadataBase` and each page's canonical (the home page's is the bare origin, with no slash). `/sitemap-index.xml` lists `/sitemap-pages.xml`, which lists the public pages: `/`, `/privacy/` and `/support/`. Production's `robots.txt` allows every crawler. Staging's disallows every crawler except `AhrefsSiteAudit`, which gets Production's rules so a site audit given the password can crawl Staging as it would Production. Both list their own sitemap index. A local build disallows everything and lists no sitemap.
- **CI and deploys:** every workflow, the required checks, how each environment deploys from CI, and each environment's own Cloudflare token are in [CI](ci.md).
- **Web consoles use Claude in Chrome.** For web consoles (GitHub settings, the Cloudflare dashboard, App Store Connect) and owner-only dashboard steps, such as secret-value clicks, use Claude in Chrome (owner, 2026-10-06), not the built-in browser. GitHub actions themselves (issues, PRs, comments, merges, workflow runs) still go through serp-agent's `gh.sh`. Never read, type or print a secret there. A dashboard's key is the owner's to set from their own terminal ([Secret Authority](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-operations/secret-authority.md)).
- **Deploys come only from CI.** The `deploy:*` scripts are for a person in an emergency; agents never run them, or `wrangler deploy`. To check a build in the Workers runtime without deploying, from `apps/web/`: `pnpm build:production`, then `pnpm exec opennextjs-cloudflare preview --env production --port <port>`, then `scripts/smoke.sh http://localhost:<port> production`. For Staging, the same with `build:staging`, `--env staging` and `staging`. A preview with `--env` rewrites `Host` to the custom domain, so it never shows the host redirects. Check those on a preview with no `--env`, sending `Host: www.farty.fm` or `Host: pedos-web-staging.serpcompany.workers.dev`.
- **The smoke test** is `scripts/smoke.sh <base-url> staging|production`. On both, it checks the pages, icons and microphone policy, that `robots.txt` answers with no password and lists the sitemap index, and that the sitemaps name the environment's host. On Staging, a page and a static file refuse a wrong password (401 with `WWW-Authenticate`) and pass with `stagingpassword`, with no `noindex` and a canonical on `staging.farty.fm`. The header alone passes with `noindex`, the Fixture Library's index asks for the password even with the header, and `robots.txt` disallows `*` and gives `AhrefsSiteAudit` Production's rules. On Production, nothing asks for a password, even a wrong one, nothing has `noindex`, canonicals are on `farty.fm`, `robots.txt` allows crawling, and no Fixture Library is served. Off localhost, on both, `/dev/mail/` and `/dev/checkout/` answer 404, `/api/auth/get-session` answers 200 JSON and a malformed sign-in from the site gets a 400. The two sign-in checks need the environment's `BETTER_AUTH_SECRET`, so they fail (503) on a deploy that comes before `web-auth-secret.yml` has run there. A local preview's sign-in is the e2e journey's. On a workers.dev host, it also checks that a request without the header gets a 308 to the branded host, and checks the branded host itself (and `www` on Production). The branded-host checks skip with a `::warning::` when Bot Fight Mode challenges the runner.
- **Accounts, payments, the Staging gate and releases** have their own pages: [Accounts and sign-in](accounts.md), [Payments](payments.md), [Staging access](staging-access.md) and [Promotion and releases](releases.md).

## Tapping through

Before review, the author walks each user-visible change at phone size on the local Workers build behind the Staging gate. The [`verify-pedos-web`](../../.claude/skills/verify-pedos-web/SKILL.md) skill has the steps. In short, from `apps/web/`:

```sh
cp .dev.vars.example .dev.vars
pnpm build:staging
pnpm db:migrate:local
# The smoke test, on the preview with --env staging:
pnpm exec opennextjs-cloudflare preview --env staging --port 4109
bash scripts/smoke.sh http://localhost:4109 staging   # in another shell
# The journeys and the tap-through, on a preview with no --env, as CI's e2e runs them:
E2E_SERVER=preview E2E_PORT=4110 pnpm test:e2e
```

Run e2e and the tap-through on the preview with no `--env`. With `--env staging`, the preview has no `BETTER_AUTH_SECRET` and the branded origin, so sign-in answers 503 locally. Give each parallel agent its own ports. After the merge, CI redeploys Staging from `staging`'s tip, and the same smoke test runs there.

**On Windows, run the Workers build and everything after it in Linux:** prefix each command above with `bash scripts/linux.sh`, or run them in one `bash scripts/linux.sh bash -c '…'`. OpenNext bundles the Worker on Windows without its Linux path rewrites, so a preview of a Windows-built Worker answers 500 on every page (`Dynamic require of "/.next/server/middleware-manifest.json"`). The script runs the command in Docker, in an image with the Node version from `.node-version` and the Chromium that the lockfile's Playwright expects. The working tree is mounted, with its own Linux `node_modules` and `.wrangler` kept in Docker volumes. `LINUX_PORT=4109` publishes a preview's port to the host, so you can open it in a Windows browser. Everything else (`pnpm check`, `pnpm dev`, the unit tests) runs on Windows itself. macOS and Linux need none of this.

## Exceptions to SERP's standards

One line each is in `apps/web/AGENTS.md`. The detail:

- **Agents tap through, not the owner and not a PR preview.** The standard's PR previews need `preview_urls` on, which Farty turns off. A `tap-through` label that deployed a PR to Staging (#124) is `later`.
- **Errors and analytics are Cloudflare's own (#126).** The standard's Sentry and GTM are not used, and nothing is sent to a third party. What remains of the standard holds: errors and analytics stay apart, error reports stop with the switch on Profile (on by default, kept in the browser) or Global Privacy Control, and the privacy page says what each collects and for how long.
  - **Errors.** `reportError(code, error)` (`src/lib/telemetry/errors.ts`) posts a stable code, the error's type name, the screen, the release (version and commit, from `next.config.ts`), the environment and how long it waited offline to `/api/telemetry/`; never a message, stack, audio, name, email or anything typed. Uncaught errors and rejections are reported too (`src/instrumentation-client.ts`). In Production the browser sends it without cookies (`credentials: 'omit'`); elsewhere it sends the Staging gate's password, which `fetch` counts as a credential too. The route takes at most 30 a minute per `cf-connecting-ip` (the `TELEMETRY_RATE_LIMIT` binding in `wrangler.jsonc`; 429 over it, and none without the binding), only this site's origin, JSON up to 1 KB and a known code with bounded fields (`report.ts`), reads no session, and logs one `client_error` line, which Workers Logs keeps up to 7 days: query `event = client_error` in the Worker's Logs. Offline, up to 20 reports wait in `localStorage` and go once the browser is online. No source maps are uploaded and no stack is sent.
  - **Analytics.** They come from Cloudflare's automatic Web Analytics, which inserts its own beacon into every page on farty.fm and staging.farty.fm at the edge (owner's decision, [#126](https://github.com/serpcompany/farty.fm/issues/126#issuecomment-6317955308)). The app loads no analytics script, has no analytics token, and the switch and Global Privacy Control don't affect it. Error reports are the only telemetry in the app.
  - **Testing it.** `/dev/telemetry/` (Staging and local runs; 404 in Production) sends a synthetic crash and handled error. `e2e/telemetry.spec.ts` checks what is sent, offline and opt-out; with `E2E_SITE_ENV=production` and `E2E_BASE_URL` on `opennextjs-cloudflare preview --env production` after `pnpm build:production`, it checks that the triggers' page is gone.

## Google Play

The Play app wraps https://farty.fm as a Trusted Web Activity: [Google Play](google-play.md) has its setup and store listing.

## Gotchas

What building the web app taught is in [Web app gotchas](web-gotchas.md).
