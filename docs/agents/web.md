# Web app: working guide

How `apps/web` is built, deployed and checked. Its commands are in `apps/web/AGENTS.md`.

## Environments and deploys

- **Branches.** `staging` is the base and default branch: every branch starts from it, and every PR goes into it. `main` is Production. It changes only by promotion from `staging` and by its release PR (see Promotion and Releases, below), never by a PR from a work branch.
- **Environments.** One Worker per deployed environment, set under `env` in `apps/web/wrangler.jsonc`. Its top level is local-only and never deployed. Each build bakes in `SITE_ENV`, so a build serves only the environment it was built for.

  | Environment | Worker | URL | Build |
  | --- | --- | --- | --- |
  | Local | none | http://localhost:3000 (`pnpm dev`) | `pnpm build`, inside `pnpm check` |
  | Staging | `pedos-web-staging` | https://staging.pedos.app | `pnpm build:staging` |
  | Production | `pedos-web-production` | https://pedos.app | `pnpm build:production` |

- **Branded hosts.** Each environment's host is a custom domain in its `routes` in `wrangler.jsonc`, and Production also takes `www.pedos.app`. The Worker entry (`apps/web/worker.ts`, with `src/lib/other-hosts.ts`) answers `www.pedos.app` with a 308 to `https://pedos.app`, and each Worker's `*.workers.dev` host with a 308 to its environment's host. Each is one hop that keeps the path (in Next's trailing-slash form) and the query. A workers.dev request with the `x-pedos-smoke-test` header is served instead, so CI's smoke test reaches the Worker even when Bot Fight Mode challenges the branded host. Production serves static files without the Worker (it doesn't set `run_worker_first`), so a static file on `www` or workers.dev is served there rather than redirected. Every environment sets `workers_dev: true` and `preview_urls: false`, so no preview URLs exist.
- **Canonicals, robots and sitemaps** name each environment's own host, from `src/lib/site.ts`. The layout sets `metadataBase` and each page's canonical (the home page's is the bare origin, with no slash). `/sitemap-index.xml` lists `/sitemap-pages.xml`, which lists the public pages: `/`, `/privacy/` and `/support/`. Production's `robots.txt` allows every crawler. Staging's disallows every crawler except `AhrefsSiteAudit`, which gets Production's rules so a site audit given the password can crawl Staging as it would Production. Both list their own sitemap index. A local build disallows everything and lists no sitemap.
- **CI.** `.github/workflows/web.yml` runs on every PR and on every push to `staging` and `main`:
  - `changes`: on a PR, whether anything the web app builds from changed (`apps/web`, `fixtures`, `catalog` or the workflow). When nothing did, `check` and `e2e` skip their steps and still report.
  - `check`: ShellCheck on the smoke test, lint, types and unit tests. On a PR it also runs both Workers builds: `build:production`, which fails if the build carries any Fixture Library file, and `build:staging`, which `check` runs only on a draft, since `e2e` builds it otherwise. On a push, the deploy job's build is the build check.
  - `e2e`: the Playwright journeys on the Staging build in workerd, behind the gate. CI writes `.dev.vars` from `.dev.vars.example` first. A draft PR skips it; it runs when the PR is marked ready. A passing run uploads a `passed-e2e-<tree>` receipt, and a push whose tree already passed skips the suite.
  - `deploy-staging` on a push to `staging`, and `deploy-production` on a push to `main`, each once `check` and `e2e` pass, in its GitHub environment. Each builds, deploys only when the commit is still the branch tip (an older run passes without deploying), then runs `scripts/smoke.sh` on its workers.dev host. Each has its own group (`deploy-web-staging`, `deploy-web-production`): a running deploy is never cancelled, and a newer queued run replaces an older one. When no push started a run (for example, `web.yml` was off), `bash ~/.claude/skills/serp-github-app/scripts/gh.sh workflow run web.yml --ref staging` (or `--ref main`) checks and redeploys that branch's tip.
  - `staging` and `main` require `changes`, `check`, `e2e` and `issue-link` (`pr-issue-link.yml`). `ios.yml` isn't required: its `paths` filter would leave its check pending.
- **Each environment has its own token.** `CLOUDFLARE_API_TOKEN` is an environment secret in `staging` and in `production`, each a different token, and `CLOUDFLARE_ACCOUNT_ID` is a repository variable. Each environment's branch policy lets only its own branch deploy: `staging` from `staging`, `production` from `main`. Each token can edit every Worker in the account, so these policies are what keep other branches away from both tokens. With no token the deploy fails, so a green run at the tip always deployed and passed the smoke test. Move or roll a secret with the `serp-create-secret` skill.
- **Deploys come only from CI.** The `deploy:*` scripts are for a person in an emergency; agents never run them, or `wrangler deploy`. To check a build in the Workers runtime without deploying, from `apps/web/`: `pnpm build:production`, then `pnpm exec opennextjs-cloudflare preview --env production --port <port>`, then `scripts/smoke.sh http://localhost:<port> production`. For Staging, the same with `build:staging`, `--env staging` and `staging`. A preview with `--env` rewrites `Host` to the custom domain, so it never shows the host redirects. Check those on a preview with no `--env`, sending `Host: www.pedos.app` or `Host: pedos-web-staging.serpcompany.workers.dev`.
- **Staging asks for a password.** The password is `stagingpassword`, with any username. It's public, so it's the plain variable `STAGING_BASIC_AUTH_PASSWORD` in `env.staging`, not a secret. The Worker entry (`apps/web/worker.ts`; the gate is `src/lib/staging-access.ts`) checks it after the host redirects and before anything is served, then strips `Authorization`. Staging sets `assets.run_worker_first`, so static files need it too. Only `/robots.txt` and requests with the `x-pedos-smoke-test` header and no `Authorization` skip it. The Fixture Library under `/fixtures/` needs the password even with that header. Every response keeps `X-Robots-Tag: noindex` unless its request passed the password. Outside Production a missing variable refuses everything. Production has no gate.
- **Local runs pass the gate.** Copy `apps/web/.dev.vars.example` to `.dev.vars` (git-ignored). Local workerd runs (`opennextjs-cloudflare preview` with no `--env`) gate pages with it, and `E2E_SERVER=preview pnpm test:e2e` sends it with Playwright's `httpCredentials`, on `E2E_PORT`. `pnpm dev` has no gate. CI's `e2e` job writes `.dev.vars` the same way.
- **Only Staging carries the Fixture Library.** `build:staging` copies it to `public/fixtures/recordings/` and sets `NEXT_PUBLIC_FIXTURE_LIBRARY=1`, which shows its loader on Profile. `build:production` removes it, then `scripts/fixture-library.ts check` fails the build if it carries any file under a `fixtures/` path, any file identical to one in `fixtures/recordings/`, or the loader's text.
- **The smoke test** is `scripts/smoke.sh <base-url> staging|production`. On both, it checks the pages, icons and microphone policy, that `robots.txt` answers with no password and lists the sitemap index, and that the sitemaps name the environment's host. On Staging, a page and a static file refuse a wrong password (401 with `WWW-Authenticate`) and pass with `stagingpassword`, with no `noindex` and a canonical on `staging.pedos.app`. The header alone passes with `noindex`, the Fixture Library's index asks for the password even with the header, and `robots.txt` disallows `*` and gives `AhrefsSiteAudit` Production's rules. On Production, nothing asks for a password, even a wrong one, nothing has `noindex`, canonicals are on `pedos.app`, `robots.txt` allows crawling, and no Fixture Library is served. On a workers.dev host, it also checks that a request without the header gets a 308 to the branded host, and checks the branded host itself (and `www` on Production). The branded-host checks skip with a `::warning::` when Bot Fight Mode challenges the runner.

### Promotion and releases

The `gh` and `git` commands here run as the organization's app, through the `serp-github-app` skill's `gh.sh` and `git.sh` ([Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md)). A person runs plain `gh` and `git`. The rules are SERP's [git workflow](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md#promoting-staging-to-production).

- **Promotion** fast-forwards `main` to `staging`'s tip, so Production gets exactly the squash commits Staging tested. The push to `main` deploys Production and smoke-tests it; a promoted tree usually has its receipt already, so `e2e` skips. `main`'s pull-request rule lets only its bypass actors, the owner and the release workflow, push it, so the owner runs:

  ```sh
  git fetch origin && git push origin origin/staging:main
  ```

  If `main` has diverged (a hotfix landed there), open a `staging` → `main` PR instead and merge it with a merge commit, then merge back (below).
- **Releases.** Release Please (`.github/workflows/release-please.yml`, configured for `apps/web` in `release-please-config.json`) keeps one `release: Pedos x.y.z` PR open on `main`, built from the commits that promotion brought. Merging it bumps `apps/web/package.json`, writes `apps/web/CHANGELOG.md` and tags `vX.Y.Z`. Nobody types versions or tags. The root `CHANGELOG.md` is the iPhone app's history, and `v1.0.0` is its release, so the web app's first release is `v1.1.0`.
- **A release PR gets its checks from a reopen.** Release Please opens and rewrites its PR with Actions' own `GITHUB_TOKEN`, which starts no workflows, so no check reports on it and `main` requires them. Right before merging, after the last push to `main`, close and reopen it as the app. That runs every required check, with none bypassed and no secret added. Once they pass, merge it:

  ```sh
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr close <n>
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr reopen <n>
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr checks <n> --watch
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr merge <n> --squash
  ```

- **Merge `main` back into `staging`** at once after a release PR, a hotfix or a diverged promotion, so the next promotion still fast-forwards. It's a `main` → `staging` PR merged with a merge commit; a squash leaves `main` diverged. Open it before anything else merges into `staging`: its head is `main`, so it can't be brought up to date. `issue-link` exempts it.

  ```sh
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr create --base staging --head main \
    --title "chore: merge main back into staging" --body "Brings the release commit from main to staging."
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr merge <n> --merge
  ```

- **Who merges.** Before the MVP, agents merge every PR, the release PR and the merge-back PR, as serp-agent, once a fresh review (for a work PR) has no open blocking finding and the required checks pass. The owner allowed it on 2026-10-21 (#106); the release-PR merge rests on the `Release PRs:` line that the move to `Stage: ship` adds to the root `AGENTS.md`. After the MVP, SERP's standard applies: merging a release PR publishes, so it needs the owner's explicit go-ahead, and the owner merges or arms every PR that no `Agents may merge` line covers.

## Tapping through

Before review, the author walks each user-visible change at phone size on the local Workers build behind the Staging gate. The [`verify-pedos-web`](../../.claude/skills/verify-pedos-web/SKILL.md) skill has the steps. In short, from `apps/web/`:

```sh
cp .dev.vars.example .dev.vars
pnpm build:staging
pnpm exec opennextjs-cloudflare preview --env staging --port 4109
# in another shell:
bash scripts/smoke.sh http://localhost:4109 staging
E2E_SERVER=preview E2E_PORT=4109 pnpm test:e2e
```

Give each parallel agent its own port. After the merge, CI redeploys Staging from `staging`'s tip, and the same smoke test runs there.

## Exceptions to SERP's standards

One line each is in `apps/web/AGENTS.md`. The detail:

- **Agents tap through, not the owner and not a PR preview.** The standard's PR previews need `preview_urls` on, which Pedos turns off. A `tap-through` label that deployed a PR to Staging (#124) is `later`. Before launch the owner is not asked to try, read or merge anything; agents merge every PR once a fresh review has no open blocking finding and the cited `pnpm check` on the head is green (#106).
- **Errors and analytics, until #126.** The web app launches with no Sentry, GTM or analytics, so the privacy page keeps the iPhone app's promise of no ads, analytics or tracking.

## Gotchas learned in slice 1

- `apps/web` isn't `"type": "module"`, so Playwright compiles `e2e/` as CommonJS. Use `__dirname`, not `import.meta`.
- Biome treats any function named `use…` as a React hook. That's why the fake-microphone helper is `withFakeMicrophone`.
- Chromium's fake microphone: `--use-file-for-fake-audio-capture=<wav>%noloop` plays the file once. It needs a PCM WAV. Fixtures 090 (G3), 084 (G♯3, two farts) and 069 (Noise-like) are the e2e cases.
- Through the fake microphone, 4 of 5 Melodic fixtures give a Recording Pitch identical to golden. 094 (low confidence) comes out 20 cents high, still B3. Expect small differences on re-recorded audio. Assert note names, not exact MIDI.
- V8's `2 ** x` and `Math.log2` differ from numpy by an ulp on some pYIN bins. `analysis/numeric.ts` has correctly rounded `exp2` and `log2`. Use them, or bit-identity breaks.
- The timing tests need `fileParallelism: false` (`vitest.config.ts`).
- Safari mutes Web Audio when the silent switch is on unless `navigator.audioSession.type = 'playback'` is set (`context.ts`). The microphone needs `'play-and-record'` while recording.
- The Welcome icon uses `next/image` with `unoptimized`, because Workers has no image optimizer.
- 16-bit WAV: encode as `round(x × 32768)`, clamped, and decode as `/32768`, as other decoders do.
- A page prerendered by `generateStaticParams` is served on Workers from the static-assets incremental cache (`open-next.config.ts`), which `opennextjs-cloudflare preview` and `deploy` fill. Without it, such a page 404s on Workers though `next build` lists it. `/compose/[song]/` is prerendered with `dynamicParams = false`, so the service worker can keep each Song's page (`/shell.json`), and an unknown Song 404s.
- Both Web Workers load one Turbopack script, each with its own chunks in the URL's fragment (`#params=`), and a worker runs what its script's response URL says. The service worker keeps a copy with no URL, or a worker started offline runs the other worker's chunks.
- Playwright's `evaluate` counts as a tap, and Chromium gives every page Playwright loads the activation of one. To test a page that was never tapped, override `UserActivation.prototype.hasBeenActive` in an init script, as `song-creator.spec.ts` does.
- `decodeAudioData` detaches the `ArrayBuffer` it's given. Pass it a copy (`wav.slice(0)`) of audio you still need, as Song Creator does with a Toot it hasn't saved.
- The owner's shell is zsh with `noclobber`. Use `>|` to overwrite files, and `bash -c` for `set -- $words` loops.
