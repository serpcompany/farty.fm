# Issue tracker: GitHub

Issues for this repo live in GitHub Issues. Use the `gh` CLI for all operations; it infers the repo inside the clone.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file> --milestone "TestFlight MVP" --label slice`.
- **Read an issue**: `gh issue view <number> --json title,body,labels,assignees,comments`. Plain `gh issue view` (without `--json`) fails on this repo because of GitHub's Projects (classic) deprecation.
- **List issues**: `gh issue list --state open --json number,title,labels,assignees`, with `--label` and `--milestone` filters as needed.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Write every issue so a fresh agent session can finish it from the issue text alone: outcome, scope, what's deliberately not included, and how it's accepted.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing and fetching

When a skill says "publish to the issue tracker," create a GitHub issue.

When a skill says "fetch the relevant ticket," run `gh issue view <number> --json title,body,labels,comments`.

## Roadmap

The MVP plan is the pinned **MVP roadmap** issue (#45). Its sub-issues are in build order, and some have their own sub-issues, one PR each. All of them are in the **TestFlight MVP** milestone.

- **Labels**: `slice` for build work, `decision` for an open question that blocks build work, `later` for ideas deferred past the MVP (no milestone).
- **Order**: `gh api repos/serpcompany/pedos-app/issues/<n>/sub_issues --jq '.[] | [.number, .state, .title]'`, starting from #45.
- **Blocking**: GitHub's built-in dependencies, not text in the body. Read them with `gh api repos/serpcompany/pedos-app/issues/<n>/dependencies/blocked_by --jq '.[] | [.number, .state]'`.
- **Next up**: the first open leaf issue in roadmap order with no open blockers and no assignee.
- **Claim**: `gh issue edit <n> --add-assignee @me`.

## Git workflow

Follow the SERP [git workflow standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md). In short:

1. Branch from `main` as `issue-<n>-<short-slug>`.
2. Open a PR into `main`:
   - The title is a Conventional Commit written for the user, for example `feat: show each Recording's pitch on the shelf`.
   - The body starts with `Closes #<n>`, says what changed and what's deliberately not included, and reports evidence level by level: build, automated tests, UI tests, installed artifact, owner acceptance.
   - For audio, report measurements on the actual output (the `tools/melody-lab/evaluate.py` checks or their Swift equivalents), not a description.
3. A fresh review agent reviews the PR. Resolve every finding, then re-review until clean, and record the outcome in the PR (for example "Review: 2 rounds, clean").
4. The owner accepts and squash-merges. Agents never merge.

Tooling notes:

- `gh pr edit` also fails on this repo; edit a PR with `gh api -X PATCH repos/serpcompany/pedos-app/pulls/<n> -f title=... -F body=@<file>`.
- Renaming a PR's head branch closes the PR. Name the branch correctly before opening it.
