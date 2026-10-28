# Farty

Farty turns fart Recordings into recognizable melodies, using only the Recordings themselves as sound. It's a web app at https://farty.fm that installs from the browser.

Farty was called Pedos until 2026-10-22 ([ADR 0009](docs/adr/0009-rename-pedos-to-farty.md)). Its stored data, Workers and databases keep the old name ([ADR 0015](docs/adr/0015-rename-the-code-names-from-pedos.md)).

## Run it

On macOS, Linux or Windows (Git Bash), with Node 22 (`.node-version`) and Corepack. Installing reads SERP's private `@serpcompany/verify` from GitHub Packages, so your user-level `~/.npmrc` needs a GitHub token with `read:packages` for `npm.pkg.github.com`.

```sh
corepack enable
pnpm install
pnpm --filter farty-web dev   # http://localhost:3000
pnpm check                    # the finish gate
```

The web app's other commands are in [its guide](apps/web/AGENTS.md). On Windows, the Workers build, its preview and the journeys run in Docker through `apps/web/scripts/linux.sh` ([Tapping through](docs/agents/web.md#tapping-through)). The Python tools use uv, from `tools/` (`uv run`).

## Explore

- [The web app](apps/web/AGENTS.md): Next.js on Cloudflare Workers. Production is https://farty.fm and Staging is https://staging.farty.fm ([environments and deploys](docs/agents/web.md)).
- [Song Catalog](catalog/catalog.json): every Song's cited public-domain score and license ([ADR 0003](docs/adr/0003-songs-come-from-cited-scores.md)), imported by [`tools/catalog`](tools/catalog/README.md).
- [Reference engine](tools/melody-lab/README.md): the Python melody engine the web app is matched to, with its listening page. Its answers are the [golden data](fixtures/golden/README.md).
- Fixture Library (`fixtures/recordings/`): real fart Recordings with their licenses, for tests and tools only. It never ships to Production.
- [Vocabulary](CONTEXT.md) and [decisions](docs/adr/).
- [Issues and planned work](https://github.com/serpcompany/farty.fm/issues).

Agents start at [`AGENTS.md`](AGENTS.md). The iPhone app, retired after Apple rejected it ([ADR 0007](docs/adr/0007-web-app-after-app-store-rejection.md), [ADR 0013](docs/adr/0013-retire-the-iphone-app-source.md)), is in the tag `archive-2026-10-27`.
