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
- **Deploys come only from CI.** The `deploy:*` scripts are for a person in an emergency; agents never run them, or `wrangler deploy`. To check a build in the Workers runtime, run `pnpm build:production`, then `pnpm exec opennextjs-cloudflare preview --env production`, which serves it on local workerd and deploys nothing.
- **Hosts.** Staging stays on `*.workers.dev` until #113 moves it to `staging.pedos.app`. Every environment sets `workers_dev: true` and `preview_urls: false`, so no preview URLs exist.
- **CI checks are off until #113.** `web.yml` and `ios.yml` are disabled, and the Staging deploy waits on no check. The author runs `pnpm check` in `apps/web` on the PR's head commit and cites the result in the PR. #113 turns the checks back on before launch.
