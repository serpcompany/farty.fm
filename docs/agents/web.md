# Web app: working guide

How `apps/web` is built, deployed and checked. Its commands are in `apps/web/AGENTS.md`.

## Environments and deploys

- **Branches.** `staging` is the base and default branch: every branch starts from it, and every PR goes into it. `main` holds releases, which reach it only by promotion from `staging` (#113).
- **Environments.** One Worker per deployed environment, set under `env` in `apps/web/wrangler.jsonc`. Its top level is local-only and never deployed. Each build bakes in `SITE_ENV`, so a build serves only the environment it was built for.

  | Environment | Worker | URL | Build |
  | --- | --- | --- | --- |
  | Local | none | http://localhost:3000 (`pnpm dev`) | `pnpm build`, inside `pnpm check` |
  | Staging | `pedos-web-staging` | https://pedos-web-staging.serpcompany.workers.dev | `pnpm build:staging` |
  | Production | `pedos-web-production` | none until launch (#113) | `pnpm build:production` |

- **Staging deploys from CI.** `.github/workflows/web-deploy.yml` runs on every push to `staging`, in the `staging` GitHub environment. It builds with `build:staging`, deploys only when the commit is still the branch tip (an older run passes without deploying), then runs `scripts/smoke.sh` against Staging. Runs share the `deploy-web-staging` group: a running deploy is never cancelled, and a newer queued run replaces an older one. Production joins at launch (#113).
- **The token lives in the `staging` environment.** `CLOUDFLARE_API_TOKEN` is an environment secret there, and `CLOUDFLARE_ACCOUNT_ID` is a repository variable. With no token the deploy fails, so a green run at the tip always deployed and passed the smoke test. Move or roll a secret with the `serp-create-secret` skill.
- **Deploys come only from CI.** The `deploy:*` scripts are for a person in an emergency; agents never run them, or `wrangler deploy`. To check a build in the Workers runtime, run `pnpm build:production`, then `pnpm exec opennextjs-cloudflare preview --env production`, which serves it on local workerd and deploys nothing. For Staging, `pnpm build:staging`, then `preview --env staging`, then `scripts/smoke.sh http://localhost:8787 staging`.
- **Staging asks for a password.** The password is `stagingpassword`, with any username. It's public, so it's the plain variable `STAGING_BASIC_AUTH_PASSWORD` in `env.staging`, not a secret. The Worker entry (`apps/web/worker.ts`; the gate is `src/lib/staging-access.ts`) checks it before anything is served, then strips `Authorization`. Staging sets `assets.run_worker_first`, so static files need it too. Only `/robots.txt` (which disallows every crawler outside Production) and requests with the `x-pedos-smoke-test` header and no `Authorization` skip it. The Fixture Library under `/fixtures/` needs the password even with that header. Every response keeps `X-Robots-Tag: noindex` unless its request passed the password. Outside Production a missing variable refuses everything. Production has no gate.
- **Local runs pass the gate.** Copy `apps/web/.dev.vars.example` to `.dev.vars` (git-ignored). Local workerd runs (`opennextjs-cloudflare preview` with no `--env`) gate pages with it, and `E2E_SERVER=preview pnpm test:e2e` sends it with Playwright's `httpCredentials`, on `E2E_PORT`. `pnpm dev` has no gate. CI writes `.dev.vars` once #113 turns `web.yml` back on.
- **Only Staging carries the Fixture Library.** `build:staging` copies it to `public/fixtures/recordings/` and sets `NEXT_PUBLIC_FIXTURE_LIBRARY=1`, which shows its loader on Profile. `build:production` removes it, then `scripts/fixture-library.ts check` fails the build if any fixture audio or loader text remains.
- **The smoke test checks the gate.** On Staging, `scripts/smoke.sh` checks a page and a static file ask for the password (401 with `WWW-Authenticate`), pass with it and drop `noindex`, the smoke-test header passes with `noindex` but not with a wrong password, and `robots.txt` answers without it, and the Fixture Library's index asks for it even with the header. On Production it checks nothing asks for a password and no Fixture Library is served.
- **Hosts.** Staging stays on `*.workers.dev` until #113 moves it to `staging.pedos.app`. Every environment sets `workers_dev: true` and `preview_urls: false`, so no preview URLs exist.
- **CI checks are off until #113.** `web.yml` and `ios.yml` are disabled, and the Staging deploy waits on no check. The author runs `pnpm check` in `apps/web` on the PR's head commit and cites the result in the PR. #113 turns the checks back on before launch.

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

- **CI checks are off until #113.** `web.yml` and `ios.yml` are disabled, so the author runs `pnpm check` on the PR's head commit and cites it in the PR. The Staging deploy (`web-deploy.yml`) stays on. #113 turns the checks back on, with deploy jobs that need them, before launch.
- **Agents tap through, not the owner and not a PR preview.** The standard's PR previews need `preview_urls` on, which Pedos turns off. A `tap-through` label that deployed a PR to Staging (#124) is `later`. Before launch the owner is not asked to try, read or merge anything; agents merge every PR once a fresh review has no open blocking finding and the cited `pnpm check` on the head is green (#106).
- **Hosts.** Staging stays on `*.workers.dev` until #113 gives each environment its branded host.
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
