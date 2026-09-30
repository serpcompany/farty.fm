# Issue tracker: GitHub

Issues for this repo live in GitHub Issues. Use the `gh` CLI for all operations; it infers the repo inside the clone.

`gh` older than 2.82.1 fails on plain `gh issue view`, `gh pr view` and `gh pr edit` because GitHub removed Projects (classic). Upgrade with `brew upgrade gh`, or use the `--json` and `gh api` forms below, which work on any version.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file> --label <slice|decision|later>`. Add `--milestone "TestFlight MVP"` for roadmap work; `later` issues have no milestone. A roadmap issue must also be placed in the roadmap (see below).
- **Read an issue**: `gh issue view <number> --json title,body,labels,assignees,comments`.
- **List issues**: `gh issue list --state open --limit 200 --json number,title,labels,assignees`, with `--label` and `--milestone` filters as needed. Without `--limit`, `gh` silently stops at 30.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.
- **Read a PR**: `gh pr view <n> --json title,body,headRefName` and `gh pr diff <n>`.
- **Edit a PR**: `gh api -X PATCH repos/serpcompany/pedos-app/pulls/<n> -f title=... -F body=@<file>`.

Write every issue so a fresh agent session can finish it from the issue text alone: outcome, scope, what's deliberately not included, and how it's accepted.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing and fetching

When a skill says "publish to the issue tracker," create a GitHub issue.

When a skill says "fetch the relevant ticket," run `gh issue view <number> --json title,body,labels,comments`.

## Roadmap

The MVP plan is the pinned **MVP roadmap** issue (#45). All roadmap issues are in the **TestFlight MVP** milestone.

- **Labels**: `slice` for build work, `decision` for an open question that blocks build work, `later` for ideas deferred past the MVP.
- **Order**: `gh api --paginate repos/serpcompany/pedos-app/issues/<n>/sub_issues --jq '.[] | [.number, .state, .title] | @tsv'`, starting from #45. Read it depth-first: a sub-issue that has its own sub-issues is replaced by its children, in their order, before moving on to its next sibling.
- **Blocking**: GitHub's built-in dependencies, not text in the body. Read them with `gh api repos/serpcompany/pedos-app/issues/<n>/dependencies/blocked_by --jq '.[] | [.number, .state] | @tsv'`. A parent's blockers also block its children.
- **Next up**: the first leaf, in depth-first order, that is open, has no open blockers, has no assignee, and has no open PR. Check for a PR with `gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("issue-<n>-")) | .number'`.
- **Claim before branching**: `gh issue edit <n> --add-assignee @me`.
- **`decision` issues**: an agent prepares the options the issue asks for (usually a listening page). The owner makes the choice, and the agent records it in an ADR and closes the issue.
- **Parallel sessions**: allowed only when they don't touch the same files. The **app** track (`ios/`) and the **tools** track (`tools/`, `catalog/`, `fixtures/golden/`) can run side by side.
- **Adding a roadmap issue**: add it under #45 (or its parent) at the right position and link its blockers. These endpoints take the numeric `id` (`gh api repos/serpcompany/pedos-app/issues/<n> --jq .id`), not the issue number:
  - `gh api -X POST repos/serpcompany/pedos-app/issues/<parent>/sub_issues -F sub_issue_id=<id>` appends it.
  - `gh api -X PATCH repos/serpcompany/pedos-app/issues/<parent>/sub_issues/priority -F sub_issue_id=<id> -F after_id=<id>` moves it.
  - `gh api -X POST repos/serpcompany/pedos-app/issues/<n>/dependencies/blocked_by -F issue_id=<id>` adds a blocker.

## Git workflow

Follow the SERP [git workflow standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md). In short:

1. Claim the issue, then branch from `main` as `issue-<n>-<short-slug>`. Name the branch correctly before opening a PR: renaming a PR's head branch closes the PR.
2. Open a small PR into `main`:
   - The title is a Conventional Commit written for the user, for example `feat: show each Recording's pitch on the shelf`.
   - The body starts with `Closes #<n>` and says what changed and what's deliberately not included.
   - It reports evidence level by level: build, automated tests, UI tests, installed artifact, owner acceptance. A lower level never proves a higher one.
   - For audio, report measurements on the actual output (the `tools/melody-lab/evaluate.py` checks or their Swift equivalents), not a description. For UI, attach a screenshot or recording from the simulator or device.
3. Review loop:
   - A fresh review agent, which didn't write the change, posts findings as PR review comments anchored to lines, each marked **blocking** or **suggestion**.
   - The author replies on every comment: fixed (with the commit) or declined (with the reason). Blocking findings are fixed or explicitly waived by the owner.
   - After pushing fixes, a new fresh reviewer checks that earlier findings were resolved and reviews the new changes. Repeat until a review has no blocking findings. After three rounds of disagreement, the owner decides.
   - Record the outcome in the PR, for example "Review: 2 rounds, clean". A clean review is not owner acceptance.
4. CI must pass and the owner must accept the change.
5. Update the branch from `main`, let CI run again, then squash-merge and delete the branch. Agents merge only when the owner has approved it. Merge one PR at a time; after each merge, update the next open PR from `main` and wait for its checks before merging it.
