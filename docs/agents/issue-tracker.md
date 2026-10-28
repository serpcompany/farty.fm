# Issue tracker: GitHub

Issues for this repo live in GitHub Issues. Use the `gh` CLI for all operations; it infers the repo inside the clone.

Agents act on GitHub only as serp-agent: every `gh` command below, and every `git` command that reaches GitHub (commit, fetch, push), runs through the `serp-github-app` skill's `gh.sh` and `git.sh`. Never use the owner's `gh` login, not even to read. See [Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md). Calling `gh.sh` from zsh: see Shell gotchas in `docs/agents/web.md`.

`gh` older than 2.82.1 fails on plain `gh issue view`, `gh pr view` and `gh pr edit` because GitHub removed Projects (classic). Upgrade with `brew upgrade gh`, or use the `--json` and `gh api` forms below, which work on any version.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file> --label <slice|decision|later>`, plus `--label tools` for tools-track work. Add `--milestone "Web MVP"` for roadmap work; `later` issues have no milestone. A roadmap issue must also be placed in the roadmap (see below).
- **Read an issue**: `gh issue view <number> --json title,body,labels,assignees,comments`.
- **List issues**: `gh issue list --state open --limit 200 --json number,title,labels,assignees`, with `--label` and `--milestone` filters as needed. Without `--limit`, `gh` silently stops at 30.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.
- **Read a PR**: `gh pr view <n> --json title,body,headRefName` and `gh pr diff <n>`.
- **Edit a PR**: `gh api -X PATCH repos/serpcompany/farty.fm/pulls/<n> -f title=... -F body=@<file>`.

Write every issue so a fresh agent session can finish it from the issue text alone: outcome, scope, what's deliberately not included, and how it's accepted.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing and fetching

When a skill says "publish to the issue tracker," create a GitHub issue.

When a skill says "fetch the relevant ticket," run `gh issue view <number> --json title,body,labels,comments`.

## Roadmap

The plan is the pinned Web MVP roadmap issue (#106). All roadmap issues are in the **Web MVP** milestone.

- **Labels**: `slice` for build work, `decision` for an open question that blocks build work, `later` for ideas deferred past the MVP, and `tools` for tools-track work (combined with `slice` or `decision`).
- **Order**: `gh api --paginate repos/serpcompany/farty.fm/issues/<n>/sub_issues --jq '.[] | [.number, .state, .title] | @tsv'`, starting from #106. Read it depth-first: a sub-issue that has its own sub-issues is replaced by its children, in their order, before moving on to its next sibling.
- **Blocking**: GitHub's built-in dependencies, not text in the body. Read them with `gh api repos/serpcompany/farty.fm/issues/<n>/dependencies/blocked_by --jq '.[] | [.number, .state] | @tsv'`. A parent's blockers also block its children.
- **Next up**: the first leaf, in depth-first order, that is open, has no open blockers, and has no open PR. An open PR on an `issue-<n>-…` branch marks an issue as taken; the orchestrator tracks claims, so agents don't assign issues. Check for a PR with `gh pr list --state open --limit 200 --json number,headRefName --jq '.[] | select(.headRefName | startswith("issue-<n>-")) | .number'`.
- **`decision` issues**: an agent prepares the options the issue asks for (usually a listening page) and asks the owner to choose. Then one PR with `Closes #<n>` adds the candidates, the listening page and an ADR recording the choice.
- **Parallel sessions (waves)**: the roadmap runs in waves. Sessions run in parallel when their issues' owned files don't overlap, each in its own worktree, dev port and `E2E_PORT`. An issue lists its owned files; other issues leave them alone and note what they need in their PR. Issues labeled `tools` are tools-track work (typically `tools/`, `catalog/` and `fixtures/golden/`).
- **Adding a roadmap issue**: add it under #106 (or its parent) at the right position and link its blockers. These endpoints take numeric issue ids (`gh api repos/serpcompany/farty.fm/issues/<number> --jq .id`), not issue numbers:
  - `gh api -X POST repos/serpcompany/farty.fm/issues/<parent-number>/sub_issues -F sub_issue_id=<new-id>` appends the new issue.
  - `gh api -X PATCH repos/serpcompany/farty.fm/issues/<parent-number>/sub_issues/priority -F sub_issue_id=<new-id> -F after_id=<sibling-id>` moves it after a sibling.
  - `gh api -X POST repos/serpcompany/farty.fm/issues/<new-number>/dependencies/blocked_by -F issue_id=<blocker-id>` adds a blocker.

## Git workflow

Follow the SERP [git workflow standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md), and [Verification cadence](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification-cadence.md) for merging and deploys. Farty's own steps:

1. Branch from `staging` as `issue-<n>-<short-slug>`. Name the branch correctly before opening a PR: renaming a PR's head branch closes the PR. `main` changes only by promotion from `staging` and by its release PR ([Promotion and releases](releases.md)), never by a PR from a work branch.
2. Open a small **draft** PR into `staging`.
   - The title is a Conventional Commit written for the user, for example `feat: show each Recording's pitch on the Recordings tab`.
   - The body starts with `Closes #<n>` and says what changed and what's deliberately not included.
   - It reports evidence level by level (see `apps/web/AGENTS.md`, Evidence). A lower level never proves a higher one.
   - For audio, report measurements on the actual output (the `tools/melody-lab/evaluate.py` checks or their equivalents), not a description. For UI, attach phone-size screenshots from the tap-through.
3. Keep test rounds few until launch. The web app's cadence:
   - **`pnpm check`** in `apps/web` on the PR's head commit: lint, types, unit tests and build. The Playwright journeys (`pnpm test:e2e`) belong to `web.yml` too. The author runs `pnpm check` and cites the result in the PR, plus the journeys when the change touches a screen, and `web.yml` runs them all again once the PR is ready.
   - **Tap through yourself** before review: at phone size, on the local Workers build behind the Staging gate (the `verify-pedos-web` skill). The owner isn't asked to. After the merge, CI deploys Staging from `staging`'s tip, with a smoke test.
   - Never run `pnpm deploy:*`; CI deploys Staging.
4. One review. Follow the git workflow's review loop: a fresh review agent that didn't write the change posts findings as PR review comments marked **blocking** or **suggestion**, and the author replies on each. Record the outcome in the PR. A clean review is not owner acceptance.
5. Update the branch from `staging`, then mark the PR ready. Merge it once [Who merges](releases.md) allows: squash-merge and delete the branch.
   - After a merge, check the linked issue. A squash merge by an agent may not auto-close it; if it is still open, close it with `gh issue close <n> --comment "Shipped in #<pr>."`.
