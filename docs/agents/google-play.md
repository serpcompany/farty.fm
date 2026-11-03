# Google Play

`android/twa-manifest.json` is the Bubblewrap config that wraps `https://farty.fm` as a Trusted Web Activity, package `com.serp.farty` (#184; it can't change once uploaded), free (#114). The web manifest already has the 512 px and maskable icons it needs. No keystore, password or `.aab` is ever committed.

## The owner, once

1. Create SERP's organization Play developer account (D-U-N-S number, $25 fee).
2. In Play Console, create the app "Farty" as a free app.
3. Tell the agent the app exists.

## The agent, after

1. Generate the upload keystore at `~/.config/pedos/android-upload.keystore` (alias `upload`) with its password in the owner's keychain, never printed. Run `bubblewrap build` from `android/` for the signed `.aab`, and hand it to the owner to upload. If Bubblewrap doesn't expand `~` in `signingKey.path`, use the absolute path for that build and don't commit it.
2. Add an `assetlinks.json` under `.well-known` in the web app's `public/` folder, with the Play app-signing SHA-256 from Play Console (Setup, App signing), plus an `apps/web/scripts/smoke.sh` check that it serves as JSON on Production.
3. Draft the store listing (below) and take phone-size screenshots.
4. Data safety: when signed in, Recordings (audio), Toots and the email address are stored with the account on Cloudflare and deleted with it, so the form declares audio as collected. Without an account, nothing personal is collected. Anonymous error reports and usage (#126) are declared too.

Most updates ship by deploying the site, with no new upload. Upload a new `.aab` (raise `appVersionCode`) only when `android/twa-manifest.json` changes.

## Store listing

Write it for the web app as it is: Farty, with accounts and paid Toot saves (ADR 0010). The owner's decisions from the iPhone app's listing (#75) still hold: the category is **Entertainment**, then **Music**, and the copyright holder is **SERP**. That listing's draft is a starting point only, since it describes the iPhone app and its "no account" promise: `git show archive-2026-10-27:docs/app-store/metadata.md`.
