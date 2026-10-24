# Web app: working guide

How `apps/web` is built, deployed and checked. Its commands are in `apps/web/AGENTS.md`.

## Environments and deploys

- **Branches.** `staging` is the base and default branch: every branch starts from it, and every PR goes into it. `main` is Production. It changes only by promotion from `staging` and by its release PR (see Promotion and Releases, below), never by a PR from a work branch.
- **Environments.** One Worker per deployed environment, set under `env` in `apps/web/wrangler.jsonc`. Its top level is local-only and never deployed. Each build bakes in `SITE_ENV`, so a build serves only the environment it was built for.

  | Environment | Worker | URL | Build |
  | --- | --- | --- | --- |
  | Local | none | http://localhost:3000 (`pnpm dev`) | `pnpm build`, inside `pnpm check` |
  | Staging | `pedos-web-staging` | https://staging.farty.fm | `pnpm build:staging` |
  | Production | `pedos-web-production` | https://farty.fm | `pnpm build:production` |

- **Data (#150).** Each deployed environment binds its own D1 as `DB` and its own R2 bucket as `MEDIA`, both named `pedos-staging` or `pedos-production`, in the SERP Cloudflare account. The top level binds `pedos-local` (database id `local-only-do-not-deploy`), kept in `.wrangler/`, and the dev mailbox KV `DEV_MAILBOX`, which no deployed environment has. Drizzle owns every table, Better Auth's too (`src/db/schema.ts`). `pnpm db:generate` writes each change's migration into `drizzle/`, and `pnpm db:migrate:local` applies them locally. Remote databases change only through CI, never from an agent's machine. `src/db/deploy-config.test.ts` fails if `DEV_MAILBOX` reaches a deployed environment, a deploy or remote migration lacks `--env`, or an environment's hosts, `BETTER_AUTH_URL` or sender disagree with `site.ts` and `SUPPORT_EMAIL`.
- **Sign-in (#152).** Better Auth email codes on D1 (`src/server/auth-config.ts`; `src/server/auth.ts` is the server-only entry, with `getSessionUser(request)`, which reads D1 on every call and throws `AuthUnavailableError` when sign-in isn't set up; `src/server/session-user.ts` hands it to the library routes, which answer 401 signed out and 503 then). Account delete also deletes the user's waiting sign-in codes (`verification`); their sessions go with the user's row (`on delete cascade`). `/api/auth/*` serves only send code, sign in with code, get session and sign out; everything else there is a 404. Codes are 6 digits, live 10 minutes, allow 3 guesses and are kept only as an HMAC under `BETTER_AUTH_SECRET`; sessions last 7 days. Writes must come from the environment's own origin as JSON, at most 16 KB. Rate limits live in D1's `rate_limit` table, keyed by HMACs, never an email or IP address: per client (`cf-connecting-ip`, IPv6 by /64) by Better Auth, with a 429; sign-in guesses at 60 an hour per client; and codes at 5 an hour per email and client, 20 an hour per email and 300 an hour site-wide, each answered like a sent code so nothing says whether an account exists (`LIMITS` in `auth-config.ts`). Once the site's 300 are spent, nobody gets a code until that hour's window ends, and each code request it holds logs one `auth_site_code_limit` line in the Worker's logs, with the limit and the seconds left and no email, client or key. Email goes out through the `EMAIL` `send_email` binding from `support@farty.fm` (`src/server/email.ts`), and Staging's binding sends only to `STAGING_SIGNUP_ALLOWLIST`, which is also the only list Staging signs up. A local run (no `SITE_ENV`) sends nothing: each email lands in the `DEV_MAILBOX` KV, listed at `/dev/mail/`, which answers 404 anywhere but a local run on a local host. So sign-in works on `pnpm dev` and on a preview with no `--env`, and answers 503 on a preview with `--env`, which has no secret and the branded origin. `BETTER_AUTH_SECRET` is a Worker secret set once per environment by `.github/workflows/web-auth-secret.yml` (`gh.sh workflow run web-auth-secret.yml --ref staging -f environment=staging`, or `--ref main` and `production`); until then that environment's sign-in answers 503. A local run without one makes its own for the process.
- **Branded hosts.** Each environment's host is a custom domain in its `routes` in `wrangler.jsonc`, and Production also takes `www.farty.fm`. The Worker entry (`apps/web/worker.ts`, with `src/lib/other-hosts.ts`) answers `www.farty.fm` with a 308 to `https://farty.fm`, and each Worker's `*.workers.dev` host with a 308 to its environment's host. Each is one hop that keeps the path (in Next's trailing-slash form) and the query. A workers.dev request with the `x-pedos-smoke-test` header is served instead, so CI's smoke test reaches the Worker even when Bot Fight Mode challenges the branded host. Production serves static files without the Worker (it doesn't set `run_worker_first`), so a static file on `www` or workers.dev is served there rather than redirected. Every environment sets `workers_dev: true` and `preview_urls: false`, so no preview URLs exist. The hosts from before the rename answer with a 301 to these from a redirect rule on their own Cloudflare zone, outside the Worker (ADR 0009).
- **Canonicals, robots and sitemaps** name each environment's own host, from `src/lib/site.ts`. The layout sets `metadataBase` and each page's canonical (the home page's is the bare origin, with no slash). `/sitemap-index.xml` lists `/sitemap-pages.xml`, which lists the public pages: `/`, `/privacy/` and `/support/`. Production's `robots.txt` allows every crawler. Staging's disallows every crawler except `AhrefsSiteAudit`, which gets Production's rules so a site audit given the password can crawl Staging as it would Production. Both list their own sitemap index. A local build disallows everything and lists no sitemap.
- **CI.** `.github/workflows/web.yml` runs on every PR and on every push to `staging` and `main`:
  - `changes`: on a PR, whether anything the web app builds from changed (`apps/web`, `fixtures`, `catalog` or the workflow). When nothing did, `check` and `e2e` skip their steps and still report.
  - `check`: ShellCheck on the smoke test, lint, types (with `wrangler types --check`), `drizzle-kit check`, a guard that fails when `pnpm db:generate` would write a migration (a `schema.ts` change without its migration), and unit tests. On a PR it also runs both Workers builds: `build:production`, which fails if the build carries any Fixture Library file, and `build:staging`, which `check` runs only on a draft, since `e2e` builds it otherwise. On a push, the deploy job's build is the build check.
  - `e2e`: the Playwright journeys on the Staging build in workerd, behind the gate. CI writes `.dev.vars` from `.dev.vars.example` and applies the migrations to the local database first. A draft PR skips it; it runs when the PR is marked ready. A passing run uploads a `passed-e2e-<tree>` receipt, and a push whose tree already passed skips the suite.
  - `deploy-staging` on a push to `staging`, and `deploy-production` on a push to `main`, each once `check` and `e2e` pass, in its GitHub environment. Each builds and, only when the commit is still the branch tip (an older run passes without deploying), applies its environment's migrations (`pnpm db:migrate:<env>`) and deploys, then runs `scripts/smoke.sh` on its workers.dev host. Each has its own group (`deploy-web-staging`, `deploy-web-production`): a running deploy is never cancelled, and a newer queued run replaces an older one. When no push started a run (for example, `web.yml` was off), `bash ~/.claude/skills/serp-github-app/scripts/gh.sh workflow run web.yml --ref staging` (or `--ref main`) checks and redeploys that branch's tip.
  - `staging` and `main` require `changes`, `check`, `e2e` and `issue-link` (`pr-issue-link.yml`). `ios.yml` isn't required: its `paths` filter would leave its check pending.
- **Each environment has its own token.** `CLOUDFLARE_API_TOKEN` is an environment secret in `staging` and in `production`, each a different token, and `CLOUDFLARE_ACCOUNT_ID` is a repository variable. Each environment's branch policy lets only its own branch deploy: `staging` from `staging`, `production` from `main`. Each token can edit every Worker in the account, so these policies are what keep other branches away from both tokens. With no token the deploy fails, so a green run at the tip always deployed and passed the smoke test. Move or roll a secret with the `serp-create-secret` skill.
- **Agents never sign in on Production.** Agents never create an account or sign in on Production (https://farty.fm, www.farty.fm). They use Staging for sign-in tests.
- **Web consoles use Claude in Chrome.** For web consoles (GitHub settings, the Cloudflare dashboard, App Store Connect) and owner-only dashboard steps, such as secret-value clicks, use Claude in Chrome (owner, 2026-10-06), not the built-in browser. GitHub actions themselves (issues, PRs, comments, merges, workflow runs) still go through serp-agent's `gh.sh`. Never read, type or print a secret there; use `serp-create-secret`.
- **Deploys come only from CI.** The `deploy:*` scripts are for a person in an emergency; agents never run them, or `wrangler deploy`. To check a build in the Workers runtime without deploying, from `apps/web/`: `pnpm build:production`, then `pnpm exec opennextjs-cloudflare preview --env production --port <port>`, then `scripts/smoke.sh http://localhost:<port> production`. For Staging, the same with `build:staging`, `--env staging` and `staging`. A preview with `--env` rewrites `Host` to the custom domain, so it never shows the host redirects. Check those on a preview with no `--env`, sending `Host: www.farty.fm` or `Host: pedos-web-staging.serpcompany.workers.dev`.
- **Staging asks for a password.** The password is `stagingpassword`, with any username. It's public, so it's the plain variable `STAGING_BASIC_AUTH_PASSWORD` in `env.staging`, not a secret. The Worker entry (`apps/web/worker.ts`; the gate is `src/lib/staging-access.ts`) checks it after the host redirects and before anything is served, then strips `Authorization`. Staging sets `assets.run_worker_first`, so static files need it too. Only `/robots.txt` and requests with the `x-pedos-smoke-test` header and no `Authorization` skip it. The Fixture Library under `/fixtures/` needs the password even with that header. Every response keeps `X-Robots-Tag: noindex` unless its request passed the password. Outside Production a missing variable refuses everything. Production has no gate.
- **Local runs pass the gate.** Copy `apps/web/.dev.vars.example` to `.dev.vars` (git-ignored). Local workerd runs (`opennextjs-cloudflare preview` with no `--env`) gate pages with it, and `E2E_SERVER=preview pnpm test:e2e` sends it with Playwright's `httpCredentials`, on `E2E_PORT`. `pnpm dev` has no gate. CI's `e2e` job writes `.dev.vars` the same way.
- **Only Staging carries the Fixture Library.** `build:staging` copies it to `public/fixtures/recordings/` and sets `NEXT_PUBLIC_FIXTURE_LIBRARY=1`, which shows its loader on Profile. `build:production` removes it, then `scripts/fixture-library.ts check` fails the build if it carries any file under a `fixtures/` path, any file identical to one in `fixtures/recordings/`, or the loader's text.
- **The smoke test** is `scripts/smoke.sh <base-url> staging|production`. On both, it checks the pages, icons and microphone policy, that `robots.txt` answers with no password and lists the sitemap index, and that the sitemaps name the environment's host. On Staging, a page and a static file refuse a wrong password (401 with `WWW-Authenticate`) and pass with `stagingpassword`, with no `noindex` and a canonical on `staging.farty.fm`. The header alone passes with `noindex`, the Fixture Library's index asks for the password even with the header, and `robots.txt` disallows `*` and gives `AhrefsSiteAudit` Production's rules. On Production, nothing asks for a password, even a wrong one, nothing has `noindex`, canonicals are on `farty.fm`, `robots.txt` allows crawling, and no Fixture Library is served. Off localhost, on both, `/dev/mail/` answers 404, `/api/auth/get-session` answers 200 JSON and a malformed sign-in from the site gets a 400. The two sign-in checks need the environment's `BETTER_AUTH_SECRET`, so they fail (503) on a deploy that comes before `web-auth-secret.yml` has run there. A local preview's sign-in is the e2e journey's. On a workers.dev host, it also checks that a request without the header gets a 308 to the branded host, and checks the branded host itself (and `www` on Production). The branded-host checks skip with a `::warning::` when Bot Fight Mode challenges the runner.

### Promotion and releases

The `gh` and `git` commands here run as the organization's app, through the `serp-github-app` skill's `gh.sh` and `git.sh` ([Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md)). A person runs plain `gh` and `git`. The rules are SERP's [git workflow](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md#promoting-staging-to-production).

- **Promotion** fast-forwards `main` to `staging`'s tip, so Production gets exactly the squash commits Staging tested. The push to `main` deploys Production and smoke-tests it; a promoted tree usually has its receipt already, so `e2e` skips. `main`'s pull-request rule lets only its bypass actors, the owner and the release workflow, push it, so the owner runs:

  ```sh
  git fetch origin && git push origin origin/staging:main
  ```

  If `main` has diverged (a hotfix landed there), open a `staging` → `main` PR instead and merge it with a merge commit, then merge back (below).
- **Releases.** Release Please (`.github/workflows/release-please.yml`, configured for `apps/web` in `release-please-config.json`) keeps one `release: Farty x.y.z` PR open on `main`, built from the commits that promotion brought. Merging it bumps `apps/web/package.json`, writes `apps/web/CHANGELOG.md` and tags `vX.Y.Z`. Nobody types versions or tags. The root `CHANGELOG.md` is the iPhone app's history, and `v1.0.0` is its release, so the web app's first release is `v1.1.0`.
- **A release PR gets its checks from a reopen.** Release Please opens and rewrites its PR with Actions' own `GITHUB_TOKEN`, which starts no workflows, so no check reports on it and `main` requires them. Right before merging, after the last push to `main`, close and reopen it as the app. That runs every required check, with none bypassed and no secret added. Once they pass, merge it:

  ```sh
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr close <n>
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr reopen <n>
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr checks <n> --watch
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr merge <n> --squash
  ```

- **Web releases roll forward, not back.** From #168 on, the library is IndexedDB version 3, which an older build can't open (`VersionError`), so a Cloudflare rollback past it breaks the library in every browser that opened the newer build. Fix forward with a new release instead, and say so in a release PR's Merge Danger.
- **Merge `main` back into `staging`** at once after a release PR, a hotfix or a diverged promotion, so the next promotion still fast-forwards. It's a `main` → `staging` PR merged with a merge commit; a squash leaves `main` diverged. Open it before anything else merges into `staging`: its head is `main`, so it can't be brought up to date. `issue-link` exempts it.

  ```sh
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr create --base staging --head main \
    --title "chore: merge main back into staging" --body "Brings the release commit from main to staging."
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr merge <n> --merge
  ```

- **Who merges.** Before the MVP, agents merge every PR as serp-agent: work PRs, release PRs and merge-back PRs. A work PR merges once a fresh review has no open blocking finding, the cited local `pnpm check` on its head is green and the required checks pass; a release or merge-back PR once the required checks pass. Agents also tap through user-visible changes themselves. The owner isn't asked to merge, review or tap through, only to choose between design options, for secret-value clicks (`serp-create-secret`) and for what the hard limits forbid. The owner allowed all of this on 2026-10-21 (#106). After the MVP, SERP's standard applies: merging a release PR publishes, so it needs the owner's explicit go-ahead, and the owner merges or arms every PR that no `Agents may merge` line covers.

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

## Exceptions to SERP's standards

One line each is in `apps/web/AGENTS.md`. The detail:

- **Agents tap through, not the owner and not a PR preview.** The standard's PR previews need `preview_urls` on, which Farty turns off. A `tap-through` label that deployed a PR to Staging (#124) is `later`. For who merges before launch, see Who merges, above.
- **Errors and analytics are Cloudflare's own (#126).** The standard's Sentry and GTM are not used, and nothing is sent to a third party. What remains of the standard holds: errors and analytics stay apart, error reports stop with the switch on Profile (on by default, kept in the browser) or Global Privacy Control, and the privacy page says what each collects and for how long.
  - **Errors.** `reportError(code, error)` (`src/lib/telemetry/errors.ts`) posts a stable code, the error's type name, the screen, the release (version and commit, from `next.config.ts`), the environment and how long it waited offline to `/api/telemetry/`; never a message, stack, audio, name, email or anything typed. Uncaught errors and rejections are reported too (`src/instrumentation-client.ts`). In Production the browser sends it without cookies (`credentials: 'omit'`); elsewhere it sends the Staging gate's password, which `fetch` counts as a credential too. The route takes at most 30 a minute per `cf-connecting-ip` (the `TELEMETRY_RATE_LIMIT` binding in `wrangler.jsonc`; 429 over it, and none without the binding), only this site's origin, JSON up to 1 KB and a known code with bounded fields (`report.ts`), reads no session, and logs one `client_error` line, which Workers Logs keeps up to 7 days: query `event = client_error` in the Worker's Logs. Offline, up to 20 reports wait in `localStorage` and go once the browser is online. No source maps are uploaded and no stack is sent.
  - **Analytics.** They come from Cloudflare's automatic Web Analytics, which inserts its own beacon into every page on farty.fm and staging.farty.fm at the edge (owner's decision, [#126](https://github.com/serpcompany/farty.fm/issues/126#issuecomment-6317955308)). The app loads no analytics script, has no analytics token, and the switch and Global Privacy Control don't affect it. Error reports are the only telemetry in the app.
  - **Testing it.** `/dev/telemetry/` (Staging and local runs; 404 in Production) sends a synthetic crash and handled error. `e2e/telemetry.spec.ts` checks what is sent, offline and opt-out; with `E2E_SITE_ENV=production` and `E2E_BASE_URL` on `opennextjs-cloudflare preview --env production` after `pnpm build:production`, it checks that the triggers' page is gone.

## Google Play

`android/twa-manifest.json` is the Bubblewrap config that wraps `https://farty.fm` as a Trusted Web Activity, package `com.serp.farty` (#184; it can't change once uploaded), free (#114). The web manifest already has the 512 px and maskable icons it needs. No keystore, password or `.aab` is ever committed.

**The owner, once:**

1. Create SERP's organization Play developer account (D-U-N-S number, $25 fee).
2. In Play Console, create the app "Farty" as a free app.
3. Tell the agent the app exists.

**The agent, after:**

1. Generate the upload keystore at `~/.config/pedos/android-upload.keystore` (alias `upload`) with its password in the owner's keychain, never printed. Run `bubblewrap build` from `android/` for the signed `.aab`, and hand it to the owner to upload. If Bubblewrap doesn't expand `~` in `signingKey.path`, use the absolute path for that build and don't commit it.
2. Add `apps/web/public/.well-known/assetlinks.json` with the Play app-signing SHA-256 from Play Console (Setup, App signing), plus an `apps/web/scripts/smoke.sh` check that it serves as JSON on Production.
3. Draft the store listing from `docs/app-store/metadata.md` and take phone-size screenshots.
4. Data safety: when signed in, Recordings (audio), Toots and the email address are stored with the account on Cloudflare and deleted with it, so the form declares audio as collected. Without an account, nothing personal is collected. Anonymous error reports and usage (#126) are declared too.

Most updates ship by deploying the site, with no new upload. Upload a new `.aab` (raise `appVersionCode`) only when `android/twa-manifest.json` changes.

## Gotchas learned in slice 1

- `apps/web` isn't `"type": "module"`, so Playwright compiles `e2e/` as CommonJS. Use `__dirname`, not `import.meta`.
- Biome treats any function named `use…` as a React hook. That's why the fake-microphone helper is `withFakeMicrophone`.
- Chromium's fake microphone: `--use-file-for-fake-audio-capture=<wav>%noloop` plays the file once. It needs a PCM WAV. Fixtures 090 (G3), 084 (G♯3, two farts) and 069 (Noise-like) are the e2e cases. It plays from the moment the stream opens, before the app captures, so a take loses the file's first tens of ms (60 ms on CI). That cost 094, which is loud from 8 ms, its steady note (#141). A spec whose farts must start whole uses `e2e/fake-microphone.ts`, which plays each fart as Record is pressed, and `waitForOpenMicrophone`, which waits for the app's capture processor rather than getUserMedia (#172).
- Accounts in the journeys (#155): a guest's farts last only the visit, so a spec that relaunches the browser signs in first (`signInByApi` in `e2e/account.ts`, with the code from `/dev/mail/`). Locally every request comes from 127.0.0.1, one client with 10 codes in 10 minutes, so `ownClient` gives each test its own `cf-connecting-ip`, which Miniflare passes through. `skipWelcome` and `recordAndSave` (`e2e/record.ts`) keep the account step out of the way unless a spec asks for it.
- Through the fake microphone, 4 of 5 Melodic fixtures give a Recording Pitch identical to golden. 094 (low confidence) comes out 20 cents high, still B3. Expect small differences on re-recorded audio. Assert note names, not exact MIDI.
- V8's `2 ** x` and `Math.log2` differ from numpy by an ulp on some pYIN bins. `analysis/numeric.ts` has correctly rounded `exp2` and `log2`. Use them, or bit-identity breaks.
- The timing tests need `fileParallelism: false` (`vitest.config.mts`).
- Safari mutes Web Audio when the silent switch is on unless `navigator.audioSession.type = 'playback'` is set (`context.ts`). The microphone needs `'play-and-record'` while it's open, which is from the first time Record shows to the end of the launch (`keepMicrophoneOpen`), so sounds play in it then too (`setPlaybackSession`).
- The Welcome icon uses `next/image` with `unoptimized`, because Workers has no image optimizer.
- 16-bit WAV: encode as `round(x × 32768)`, clamped, and decode as `/32768`, as other decoders do.
- A page prerendered by `generateStaticParams` is served on Workers from the static-assets incremental cache (`open-next.config.ts`), which `opennextjs-cloudflare preview` and `deploy` fill. Without it, such a page 404s on Workers though `next build` lists it. `/compose/[song]/` is prerendered with `dynamicParams = false`, so the service worker can keep each Song's page (`/shell.json`), and an unknown Song 404s.
- Both Web Workers load one Turbopack script, each with its own chunks in the URL's fragment (`#params=`), and a worker runs what its script's response URL says. The service worker keeps a copy with no URL, or a worker started offline runs the other worker's chunks.
- Playwright's `evaluate` counts as a tap, and Chromium gives every page Playwright loads the activation of one. To test a page that was never tapped, override `UserActivation.prototype.hasBeenActive` in an init script, as `song-creator.spec.ts` does.
- `decodeAudioData` detaches the `ArrayBuffer` it's given. Pass it a copy (`wav.slice(0)`) of audio you still need, as Song Creator does with a Toot it hasn't saved.
- `cloudflare-env.d.ts` types the bindings for `getCloudflareContext()`. Regenerate it with `pnpm cf-typegen` after any change to bindings or vars; `pnpm typecheck` fails while it's out of date. It declares the Workers runtime's globals over the DOM's, so browser code sometimes needs the DOM's own form, such as `window.addEventListener` or `appendChild`.

## Shell gotchas

- zsh has `noclobber` set: overwrite a file with `>|`, and use `bash -c` for `set -- $words` loops.
- To call `gh.sh` through a variable, keep only its path in it: `G=~/.claude/skills/serp-github-app/scripts/gh.sh; bash $G pr view <n>`. zsh doesn't word-split `$G`, so `G="bash <path>"; $G ...` fails: zsh looks for one command named `bash <path>`. Writing the whole `bash ~/.claude/skills/serp-github-app/scripts/gh.sh ...` call, as this page does, works too.
