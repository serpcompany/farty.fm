# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply/remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Publishing and fetching

When a skill says “publish to the issue tracker,” create a GitHub issue.

When a skill says “fetch the relevant ticket,” run:

`gh issue view <number> --comments`

## Plan structure

The MVP plan is the **TestFlight MVP** milestone. Its issues are vertical slices in build order, each ending in something the product owner can hear or tap.

- **Labels**: `slice` for build work, `decision` for an open question that blocks build work, `later` for ideas deferred past the MVP (no milestone).
- **Blocking**: a `Blocked by: #<n>` line near the top of the issue body.
- **Next up**: the lowest-numbered open, unblocked, unassigned `slice` in the milestone.
- **Claim**: `gh issue edit <n> --add-assignee @me`.
- **Done**: close with a comment that says what was verified (numbers for audio, a screenshot or recording for UI), then link the PR.
