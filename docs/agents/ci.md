# CI

Every GitHub Actions workflow, what starts it, and the checks a merge waits for. Workflows hold no comments, so this doc is where their reasons live. Agents act on GitHub as described in SERP's [Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md).

| Workflow | Starts on | Jobs |
| --- | --- | --- |
| `repository.yml` | Every PR, and every push to `staging` and `main` | `verify` |
| `code-review.yml` | A PR opened, pushed to, reopened or marked ready | `review` |
| `pull-request.yml` | A PR opened, edited, pushed to or marked ready | `title`, `issue-link`, `fix-test`, `text` |
| `web.yml` | Every PR, every push to `staging` and `main`, and by hand | `changes`, `check`, `e2e`, `deploy-staging`, `deploy-production` |
| `tools.yml` | Every PR, every push to `staging` and `main`, and by hand | `tools-changes`, `reference`, `scores` |
| `release-please.yml` | Every push to `main` | `release-please` |
| `web-auth-secret.yml` | By hand only | `secret` |
| `maintenance.yml` | Every Monday at 14:00 UTC, and by hand | `doc-gardening` |

## Required checks

`staging` and `main` require `verify`, `title`, `issue-link`, `fix-test`, `text`, `changes`, `check` and `e2e`, and every review thread resolved. A required workflow has no `paths` filter, since a skipped one leaves its check pending: `web.yml`'s `changes` job decides instead, and its jobs still report when they skip their steps. `tools.yml`'s `tools-changes` works the same way, so its `reference` and `scores` are ready to be required too. `review` isn't required: a merge waits on its threads instead.

## Repository

- **`verify`** installs the workspace, with `@serpcompany/verify` from GitHub Packages, and runs `pnpm verify`: every SERP check, at the version the lockfile pins ([Verification](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification/README.md)). It checks out the commit with its parent, which it names `SERP_VERIFY_BASE`, so each exception list can only shrink against it. The docs check reads links into SERP's private repositories with the `serp-agent` app's short-lived token when `SERP_AGENT_APP_ID` and `SERP_AGENT_PRIVATE_KEY` are set, and with the job's own token otherwise.
## Code review

`code-review.yml` is its own workflow, as SERP's [code review](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification/code-review/github-actions.md) standard sets, so a PR that changes `repository.yml` or another workflow is still reviewed.

- **`review`** runs on a PR that isn't a draft or a bot's, beside `verify` rather than after it. It installs the review's scripts from the same package version outside the checkout, gives Claude the rules (`AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, [`docs/agents/code.md`](code.md), `apps/web/AGENTS.md`, as they are on the base branch), the change since the last reviewed commit, its issue and the earlier findings, and runs the [`pr-review`](../../.claude/skills/pr-review/SKILL.md) skill. Claude posts findings inline, marked blocking or suggestion, and the job posts one summary comment. It skips with a notice until `CLAUDE_CODE_OAUTH_TOKEN` is set. It never reviews a PR that changes `code-review.yml` itself, since Claude runs only from the default branch's copy of its workflow: a person reviews such a PR.

## Pull request

Each job runs one of SERP's [pull request checks](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification/pull-request-checks/README.md) from the installed package, through the local action `.github/actions/pull-request-check`. This repository is public, so it can't call serp's private action itself, and the alignment rule `ci-pull-request-checks` stays failed while it is. Running the package's own code keeps the checks identical:

- **`title`:** a Conventional Commit (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`).
- **`issue-link`:** the PR closes an issue (`Closes #<n>`), or says `No issue: <reason>`. Dependency updates, release PRs, and promotion and merge-back PRs between `staging` and `main` are exempt. On a hotfix into `main`, which GitHub doesn't link, it warns that the issue needs closing by hand.
- **`fix-test`:** a `fix:` PR adds or changes the test that fails without the fix.
- **`text`:** no local paths (a home folder or a scratch path) in the title or body.

## Web

`web.yml` runs on every PR and on every push to `staging` and `main`:

- `changes`: on a PR, whether anything the web app builds from changed (`apps/web`, `fixtures`, `catalog`, the root's package files or the workflow). When nothing did, `check` and `e2e` skip their steps and still report.
- `check`: ShellCheck on the smoke test, lint, types (with `wrangler types --check`), `drizzle-kit check`, a guard that fails when `pnpm db:generate` would write a migration (a `schema.ts` change without its migration), and unit tests. On a PR it also runs both Workers builds: `build:production`, which fails if the build carries any Fixture Library file, and `build:staging`, which `check` runs only on a draft, since `e2e` builds it otherwise. On a push, the deploy job's build is the build check.
- `e2e`: the Playwright journeys on the Staging build in workerd, behind the gate. CI writes `.dev.vars` from `.dev.vars.example` and applies the migrations to the local database first. A draft PR skips it; it runs when the PR is marked ready. A passing run uploads a `passed-e2e-<tree>` receipt, and a push whose tree already passed skips the suite.
- `deploy-staging` on a push to `staging`, and `deploy-production` on a push to `main`, each once `check` and `e2e` pass, in its GitHub environment. Each builds and, only when the commit is still the branch tip (an older run passes without deploying), applies its environment's migrations (`pnpm db:migrate:<env>`) and deploys, then runs `scripts/smoke.sh` on its workers.dev host. Each has its own group (`deploy-web-staging`, `deploy-web-production`): a running deploy is never cancelled, and a newer queued run replaces an older one. When no push started a run, `gh workflow run web.yml --ref staging` (or `--ref main`) checks and redeploys that branch's tip.

Each step that runs one of the web app's scripts names `working-directory: apps/web` itself, rather than through the job's `defaults`, because Knip reads a step's own working directory to find the scripts and binaries it runs.

**Each environment has its own token.** `CLOUDFLARE_API_TOKEN` is an environment secret in `staging` and in `production`, each a different token, and `CLOUDFLARE_ACCOUNT_ID` is a repository variable naming the SERP account, which `wrangler.jsonc` also names (`account_id`), so `wrangler` picks it on a machine whose login sees more than one account. If the two ever differ, `wrangler.jsonc` wins. Each environment's branch policy lets only its own branch deploy: `staging` from `staging`, `production` from `main`. Each token can edit every Worker in the account, so these policies are what keep other branches away from both tokens. With no token the deploy fails, so a green run at the tip always deployed and passed the smoke test. Since each is account-wide, making or rolling one is the owner's ([Secret Authority](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-operations/secret-authority.md)).

## Tools

`tools.yml` checks the Python reference engine and the catalog importer, the `tools/` uv project ([the reference engine](../../tools/melody-lab/README.md)):

- `tools-changes`: on a PR, whether anything they read changed (`tools`, `fixtures`, `catalog`, the web app's ship list, `.python-version` or the workflow). When nothing did, `reference` and `scores` skip their steps and still report.
- `reference`: installs uv 0.7.2, the version that wrote `tools/uv.lock`, and the locked environment with Python 3.12.10 (`uv sync --locked`), runs the unit tests (`uv run pytest`), then runs `export_golden.py` and fails if `fixtures/golden` isn't byte for byte what it wrote, new files included, so the reference and the golden data can't drift apart. The export gives the same bytes on Linux and Windows.
- `scores`: re-hashes every score `catalog/catalog.json` names against its `sha256`, so a changed or missing score fails.

## Release Please and the auth secret

- **`release-please.yml`** keeps the release PR open on `main` ([Promotion and releases](releases.md)).
- **`web-auth-secret.yml`** sets `BETTER_AUTH_SECRET` on one environment's Worker, only when it has none, since a new secret signs everyone out. `openssl` writes the value straight into `wrangler secret put`, and nothing prints it. Run it from the environment's own branch, which its deployment rules require: `gh workflow run web-auth-secret.yml --ref staging -f environment=staging`, or `--ref main` and `production`.

## Weekly maintenance

`maintenance.yml` keeps the docs true between changes, like zenbu's weekly maintenance. It runs every Monday, and by hand (`gh workflow run maintenance.yml --ref staging`). Its one job, `doc-gardening`, skips until `CLAUDE_CODE_OAUTH_TOKEN` is set:

- **The work list** is built from the repository alone, under the git-ignored `tmp/`: `pnpm --filter farty-web docs:report` lists each doc whose named or linked code, config or test files changed after the doc was last edited, the most changed first (`apps/web/scripts/docs-report.ts`), and `pnpm verify docs --external` lists the broken outside links. ADRs, changelogs and generated reports aren't listed, and a link to another doc doesn't count, since that doc is checked itself.
- **Claude** (Sonnet 5.5, at most 80 turns) takes up to eight of those docs and every broken link, checks each against the code, and fixes what's no longer true, in Markdown only: never an ADR, a changelog, `docs/agents/exceptions.md`, `AGENTS.md`'s merge list, code, tests, workflows or config. It runs `pnpm verify docs`, then opens one PR into `staging` from `docs/gardening-<date>`, titled `docs: weekly doc gardening (<date>)`, with a `No issue:` line, or says "No doc drift found". While a gardening PR is open, it opens no other.
- **The last step passes only on an outcome:** a PR opened in this run, "No doc drift found", or an open gardening PR left alone. It fails when Claude left no log, ended in an error or with subagents running, or reached none of these, and keeps the transcript (`doc-gardening-transcript`).
- **Its PR starts no checks by itself,** since `github-actions[bot]` opens it with the job's own token. Skim it, then close and reopen it, which starts every check and the review, and merge it once green. It changes only docs, but `AGENTS.md`, `ARCHITECTURE.md` and `apps/web/AGENTS.md` are off the agents' merge list, so a PR that touches one is the owner's to merge.

## Dependencies

Dependabot (`.github/dependabot.yml`) opens one weekly PR of minor and patch npm updates, reading `@serpcompany/verify` through the repository's read grant on the package, and one for the actions below. A PR that moves an action updates its row in the table.

## Pinned actions

Every workflow and the local action run each action at a commit, not a tag: a tag can be moved to new code, and these jobs hold Cloudflare's tokens, Claude's and a token that reads the private package. Each was pinned on 2026-10-27 to the commit its major tag named that day, so pinning changed no code that runs. `astral-sh/setup-uv` has no major tag, so it is pinned to the v10.3.0 release, the newest that was at least two weeks old that day.

| Action | Commit | Version |
| --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 |
| `actions/setup-node` | `a0853c24544627f65ddf259abe73b1d18a591444` | v5.0.0 |
| `pnpm/action-setup` | `0977fd99725f1db4007ccb2928dbb4e90d06cc86` | v6.0.10 |
| `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | v7.0.2 |
| `actions/create-github-app-token` | `64ab729a6294000f5aa4a4bc0b73d1f32bc45510` | v3.3.0 |
| `googleapis/release-please-action` | `5c625bfb5d1ff62eadeeb3772007f7f66fdcf071` | v4.4.1 |
| `anthropics/claude-code-action` | `6b6870e649b5ff408753befeaee5fc7989d4e6a9` | v1.0.258 |
| `astral-sh/setup-uv` | `1c37ad07a6a961277cf70c0d37d6f313000f5884` | v10.3.0 |

## Set up once, by the owner

- **The package:** in `@serpcompany/verify`'s settings, Manage Actions access, add `serpcompany/farty.fm` with Read. Without it every install in CI fails, and `verify` says so.
- **The review and doc gardening:** the Actions secret `CLAUDE_CODE_OAUTH_TOKEN`.
- **The docs check's links into SERP's private repositories:** the variable `SERP_AGENT_APP_ID` and the secret `SERP_AGENT_PRIVATE_KEY`, at repository or organization level.
- **The branch rules** in Required checks, above, with `reference` and `scores` added.
