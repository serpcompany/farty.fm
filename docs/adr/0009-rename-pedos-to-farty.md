# Rename Pedos to Farty

The app was called Pedos, on pedos.app. From 2026-10-22 it is **Farty**, on **farty.fm** (#184). The owner decided the rename that day and bought farty.fm through Cloudflare Registrar. The display name follows the domain.

## Why

In English, "pedo" is common slang for pedophile, so most English speakers read "pedos" that way. The intended meaning, farts in Spanish, only works in Spanish. A fart app for a broad audience can't carry a name that reads as that.

## What changes

- **Hosts.** Production is farty.fm, with www.farty.fm sending a 308 to it, and Staging is staging.farty.fm. `apps/web/src/lib/site.ts` holds them, and `BETTER_AUTH_URL` in `apps/web/wrangler.jsonc` matches it.
- **The old hosts.** pedos.app, www.pedos.app and staging.pedos.app are no longer the Worker's custom domains. A redirect rule on the pedos.app zone answers each with a 301 to the same path on farty.fm or staging.farty.fm, query included, outside the Worker. Keep renewing pedos.app for it.
- **Name.** Everything a user sees says Farty: the screens, page titles, the web app manifest, the Privacy and Support pages, the sign-in email (from `Farty <support@farty.fm>`) and the Staging password prompt. Release PRs are titled `release: Farty x.y.z`.
- **Android.** The Trusted Web Activity wraps farty.fm as `com.serp.farty`, set before the first Play upload, because a package ID can't change once published.

## What stays internal

These keep the old name, so users' data keeps opening and the infrastructure keeps working:

- the `pedos` IndexedDB database, the `pedos.*` localStorage keys, the `pedos` cookie prefix and the `x-pedos-*` headers;
- the Workers (`pedos-web-staging`, `pedos-web-production`) and their workers.dev hosts, the D1 databases and R2 buckets;
- the repository, `apps/web`'s package name, folders such as `components/pedos/`, code identifiers such as `usePedos`, and the `verify-pedos-web` skill;
- `ios/` and `docs/app-store/`, which are history.

Renaming any of these is separate work.

## Consequences

- Hosts, sign-in and the email sender switch in one deploy. farty.fm's Email Routing and Email Sending must be set up before it, or sign-in codes don't send.
- Cookies are per host, so a signed-in user signs in again on farty.fm. Their Recordings and Toots are on the account and sync back down. What each browser kept for pedos.app stays there: a guest's visit, unsent changes, the error-report switch and a Home Screen install of pedos.app, which should be installed again from farty.fm.
- Older ADRs keep the name Pedos, as history.
