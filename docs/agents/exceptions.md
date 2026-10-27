# Exceptions

Each rule turned off in a tool's config file, with its reason, as SERP's [Verification](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification/README.md#exceptions) standard requires: a config file can't hold the reason without a comment. An exception in a check's own list (a large file, a duplicate pair) lives in `verify.json`, with its reason there. A rule is never switched off in the code it flags.

| Where | Off | Why |
| --- | --- | --- |
| `apps/web/biome.json`, the override for `src/components/ui/**` | `a11y/useSemanticElements`, `a11y/useKeyWithClickEvents`, `a11y/useFocusableInteractive` | These are shadcn's own components, kept as shadcn writes them so they can be updated from it. The screens that use them are checked in full. |
| `knip.json`, `apps/web`'s `ignoreDependencies` | `cloudflare` | The Workers tests import `cloudflare:test`, a module `@cloudflare/vitest-plugin` provides at runtime. No package by that name exists to list. |
| `verify.json`, `docs.github.exempt` | `.claude/skills/pr-review/SKILL.md` | The Repository workflow's `review` job runs it, and its `gh` commands read the pull request with that job's own token, not an agent's. |
