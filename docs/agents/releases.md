# Promotion and releases

How Production gets what Staging tested, how releases are cut, and who merges. Every workflow is in [CI](ci.md).

The `gh` and `git` commands here run as the organization's app, through the `serp-github-app` skill's `gh.sh` and `git.sh` ([Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md)). A person runs plain `gh` and `git`. The rules are SERP's [git workflow](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/git-workflow.md#promoting-staging-to-production).

- **Promotion** fast-forwards `main` to `staging`'s tip, so Production gets exactly the squash commits Staging tested. The push to `main` deploys Production and smoke-tests it; a promoted tree usually has its receipt already, so `e2e` skips. `main`'s pull-request rule lets only its bypass actors, the owner and the release workflow, push it, so the owner runs:

  ```sh
  git fetch origin && git push origin origin/staging:main
  ```

  If `main` has diverged (a hotfix landed there), open a `staging` → `main` PR instead and merge it with a merge commit, then merge back (below).
- **Releases.** Release Please (`.github/workflows/release-please.yml`, configured for `apps/web` in `release-please-config.json`) keeps one `chore: release Farty x.y.z` PR open on `main`, built from the commits that promotion brought. Merging it bumps `apps/web/package.json`, writes `apps/web/CHANGELOG.md` and tags `vX.Y.Z`. Nobody types versions or tags. The iPhone app's history and its `v1.0.0` release are in tags (ADR 0016), so the web app's first release was `v1.1.0`.
- **A release PR gets its checks from a reopen.** Release Please opens and rewrites its PR with Actions' own `GITHUB_TOKEN`, which starts no workflows, so no check reports on it and `main` requires them. Right before merging, after the last push to `main`, close and reopen it as the app. That runs every required check, with none bypassed and no secret added. Once they pass, merge it:

  ```sh
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr close <n>
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr reopen <n>
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr checks <n> --watch
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr merge <n> --squash
  ```

- **Web releases roll forward, not back.** From #168 on, the library is IndexedDB version 3, and from #268 version 4, which an older build can't open (`VersionError`), so a Cloudflare rollback past either breaks the library in every browser that opened the newer build. Version 4 is there so a build from before #268 never sends a queued `place` as a delete. Fix forward with a new release instead, and say so in a release PR's Merge Danger. Rolling back below covers the rare case where a rollback is safe.

## Rolling back

Only the owner rolls back, and only in an emergency: agents never run `wrangler rollback`, `wrangler versions deploy` or `wrangler d1 time-travel restore` (`.claude/settings.json` denies or asks).

- **The Worker** can go back to its previous version (Cloudflare dashboard, the Worker's Deployments, or `wrangler rollback --env production` from `apps/web/`) only when nothing between the two versions raised the IndexedDB version or added a migration the older code can't read. Otherwise, fix forward.
- **Migrations are additive.** A migration never drops or renames a table or column that the release before it reads. A removal ships in a later release, once no deployed code reads the old shape, so the Worker before a migration still works on the database after it.
- **The database:** each deploy records D1's restore point (`pnpm db:bookmark:<env>`, the deploy job's "Record … database restore point" step) before it migrates. `wrangler d1 time-travel restore pedos-production --env production --bookmark <bookmark from that step>` puts the database back as it was before that deploy, within 30 days. It also discards every write since then, including users' saves, so it's a last resort.
- **Merge `main` back into `staging`** at once after a release PR, a hotfix or a diverged promotion, so the next promotion still fast-forwards. It's a `main` → `staging` PR merged with a merge commit; a squash leaves `main` diverged. Open it before anything else merges into `staging`: its head is `main`, so it can't be brought up to date. `issue-link` exempts it. If something merged into `staging` first, close that PR and branch from `main` instead: merge `origin/staging` into the branch and open the branch → `staging` with a `No issue:` line, still merged with a merge commit. The branch's diff against `staging` should be only what `main` has and `staging` lacks, such as the version bump and changelog (#244).

  ```sh
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr create --base staging --head main \
    --title "chore: merge main back into staging" --body "Brings the release commit from main to staging."
  bash ~/.claude/skills/serp-github-app/scripts/gh.sh pr merge <n> --merge
  ```

- **Who merges.** `AGENTS.md`'s `Agents may merge: listed paths` line decides (owner, 2026-10-27). An agent merges a PR whose every file is on that list, once a fresh review has no open blocking finding, the cited local `pnpm check` on its head is green and the required checks pass. The owner merges every other PR, release and merge-back PRs included: merging a release PR publishes. Agents still tap through user-visible changes themselves. The pre-launch grant that let agents merge everything (#106, 2026-10-21) ended with the MVP.
