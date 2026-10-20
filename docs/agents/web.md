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
- **Staging asks for a password.** The password is `stagingpassword`, with any username. It's public, so it's the plain variable `STAGING_BASIC_AUTH_PASSWORD` in `env.staging`, not a secret. The Worker entry (`apps/web/worker.ts`; the gate is `src/lib/staging-access.ts`) checks it before anything is served, then strips `Authorization`. Staging sets `assets.run_worker_first`, so static files need it too. Only `/robots.txt` (which disallows every crawler outside Production) and requests with the `x-pedos-smoke-test` header and no `Authorization` skip it. Every response keeps `X-Robots-Tag: noindex` unless its request passed the password. Outside Production a missing variable refuses everything. Production has no gate.
- **Local runs pass the gate.** Copy `apps/web/.dev.vars.example` to `.dev.vars` (git-ignored). Local workerd runs (`opennextjs-cloudflare preview` with no `--env`) gate pages with it, and `E2E_SERVER=preview pnpm test:e2e` sends it with Playwright's `httpCredentials`, on `E2E_PORT`. `pnpm dev` has no gate. CI writes `.dev.vars` once #113 turns `web.yml` back on.
- **The smoke test checks the gate.** On Staging, `scripts/smoke.sh` checks a page and a static file ask for the password (401 with `WWW-Authenticate`), pass with it and drop `noindex`, the smoke-test header passes with `noindex` but not with a wrong password, and `robots.txt` answers without it. On Production it checks nothing asks for a password.
- **Hosts.** Staging stays on `*.workers.dev` until #113 moves it to `staging.pedos.app`. Every environment sets `workers_dev: true` and `preview_urls: false`, so no preview URLs exist.
- **CI checks are off until #113.** `web.yml` and `ios.yml` are disabled, and the Staging deploy waits on no check. The author runs `pnpm check` in `apps/web` on the PR's head commit and cites the result in the PR. #113 turns the checks back on before launch.
