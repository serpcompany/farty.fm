# Code

The rules every change follows, the checks that hold them, and when a change is done. SERP's [Verification](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/verification/README.md) standard defines each check; this page says how this repository applies them.

## The rules

- **No comments in code.** The code says what it does: name the value, function, type or test for what it means, and move a step that needs explaining into a function named for it. Most comments are simply deleted. What the code can't carry, such as a browser quirk, a reason the engine must match the reference to the bit, or how the parts fit together, goes in the doc `AGENTS.md` routes that area to. A tool is configured in its config file, never with an inline directive (`biome-ignore`, `@ts-expect-error`, `# noqa`, `# shellcheck disable`).
- **A code file has at most 500 lines.** Split one that outgrows it by responsibility, into files named for what each does, in the change that grew it.
- **No duplicate code.** No block of 50 tokens over 5 lines appears twice: move what the copies share into one function, type or test helper.
- **Nothing unused stays.** No unused file, export or dependency, and nothing exported that only its own file uses.
- **Imports point the way the layers allow,** as [`ARCHITECTURE.md`](../../ARCHITECTURE.md#layers) lists them with what enforces each.
- **No secret is committed.** A secret lives where it is read (a Worker secret, a GitHub secret), never in the repository ([Secret Authority](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-operations/secret-authority.md)).
- **A fix comes with its test,** the one that fails without it. A test waits for a condition, never for a fixed time, and is never retried.
- **Docs stay true.** A behavior change updates its doc in the same change. Every doc is reachable from `AGENTS.md` and keeps to its size budget.
- **It works on every machine.** Scripts and commands run on macOS, Linux and Windows. On Windows that means Git Bash, which the hooks need too, and the web app's Workers build, preview and journeys run in Docker through `apps/web/scripts/linux.sh` ([Tapping through](web.md#tapping-through)).

## The checks

`pnpm verify` runs every check on every file, and `pnpm verify comments,sizes <paths>` runs some on some files. `verify.json` configures them: the files they leave as they are (generated and third-party) and the web app's TypeScript part. The checks also run by themselves:

- **As an agent writes:** Claude Code's hooks (`.claude/settings.json`) check each file an agent writes, and block with the finding, then check every changed file and the docs before a turn ends.
- **At `git commit` and `git push`:** lefthook (`lefthook.yml`, installed by `pnpm install`) checks the staged files before a commit, and runs every check before a push, then the web app's lint, types and unit tests when the branch changes it.
- **In CI:** `verify`, and the pull request checks ([CI](ci.md)).

Skipping a hook (`--no-verify`) only moves the failure to CI. A rule turned off in a tool's config file is listed with its reason in [Exceptions](exceptions.md).

## Skills

Agents' skills live in `.claude/skills/`:

- [`verify-pedos-web`](../../.claude/skills/verify-pedos-web/SKILL.md): proves a web change works in the running app, at phone size, before review.
- [`pr-review`](../../.claude/skills/pr-review/SKILL.md): reviews a pull request against these rules. The Repository workflow's `review` job runs it on every pull request.

## When a change is done

`pnpm check` passes from the root, once, on the finished tree: every check, then the web app's lint, types, migration check, unit tests and build. The evidence a change needs beyond that (a tap-through, the journeys, a deploy's smoke test) is in `apps/web/AGENTS.md`, Evidence.
