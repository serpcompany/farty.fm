# Rename the code names from Pedos

ADR 0009 renamed the app to Farty and kept every internal "pedos" name. On 2026-10-27 the owner chose to rename the code's names too, and to keep the names that stored data and running infrastructure depend on (D10 in the SERP alignment, #177, and part of #190).

## What changes

- The folder `apps/web/src/components/pedos/` is now `components/farty/`, and `PedosProvider` is `FartyProvider`.
- `apps/web`'s package name is `farty-web`. Release tags carry no package name, so release-please is unaffected.
- The build-time variables are `FARTY_RELEASE` and `FARTY_ENVIRONMENT`, the AudioWorklet is `farty-capture`, and the IndexedDB schema's type is `FartyDB`.
- The smoke test's header is `x-farty-smoke-test`. Only `scripts/smoke.sh` and the Worker read it, and CI runs the script from the commit it just deployed.
- The skill `verify-pedos-web` is `verify-web`.
- Tests and journeys use Farty names for their page globals, origins and the Staging gate's username, which the gate ignores.

## What stays

A name stays when data or another build depends on it, since renaming it would need a migration or would break a running app for a while:

- **Stored data:** the `pedos` IndexedDB database, the `pedos.*` localStorage keys, the `pedos` cookie prefix, and the service worker's `pedos-shell-*` cache.
- **Names another build shares:** the `x-pedos-library` header, which an installed app's cached build still sends, and which the server's wrong-account check reads (a request without it is allowed, so a renamed header would switch the check off for that build), and the `pedos-library` BroadcastChannel and the `pedos-open` and `pedos-sync` Web Locks, which a tab still running an older build uses.
- **Cloudflare resources:** the Workers (`pedos-web` and its environments), their workers.dev hosts, and the D1 databases and R2 buckets (#190 tracks these).
- **History:** older ADRs and the changelog keep the name Pedos.

## Consequences

- No user-visible change, and no migration.
- A new "pedos" name in code needs the reason above: data, another build, or a Cloudflare resource.
