---
name: verify-pedos-web
description: Prove a Pedos web feature works before review - start the app, check it is healthy, drive the feature with Playwright and a fixture as the fake microphone, take phone-size screenshots, and clean up. Use before marking a web PR ready, or when asked to tap through, verify or screenshot a web change.
---

# Verify the Pedos web app

Run from `apps/web/`. Proof goes in `tmp/agent/` (git-ignored) and the PR cites it. Never run `pnpm deploy:*`: CI deploys Staging.

Agents run every `gh` command, and every `git` command that reaches GitHub, as serp-agent through the `serp-github-app` skill ([Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md)).

## 1. Pick a port

Many sessions share this Mac, so pick your own `<port>` for this run, at random from 4000 to 4999: `echo $((4000 + RANDOM % 1000))`. `lsof -nP -iTCP:<port> -sTCP:LISTEN` must print nothing. If it prints a line, another session holds that port, so pick again. A taken port doesn't fail: Playwright reuses whatever answers on `E2E_PORT`, so your journeys would run on another session's build. Always set `E2E_PORT`, since its defaults (3100, and 8787 for the preview) are shared too.

## 2. Build

These are the steps CI's e2e shards run:

1. `pnpm install --frozen-lockfile`
2. `cp .dev.vars.example .dev.vars` (git-ignored; it holds Staging's public password, `stagingpassword`).
3. `pnpm build:staging`
4. `pnpm db:migrate:local`

## 3. Check it is healthy

The smoke test needs a preview with `--env staging`, which puts the static files behind the gate:

1. `mkdir -p ../../tmp/agent && pnpm exec opennextjs-cloudflare preview --env staging --port <port> >| ../../tmp/agent/preview.log 2>&1 &` (`>|` so a rerun overwrites the log under zsh's `noclobber`).
2. `curl -s -o /dev/null --retry 40 --retry-connrefused --retry-delay 2 http://localhost:<port>/` returns once it is up.
3. `bash scripts/smoke.sh http://localhost:<port> staging` must print no `FAIL` line. It checks the pages and icons, the microphone permission, and the gate (401 without the password, and `noindex` dropped with it).
4. Stop this preview (step 6) before step 4. It runs Staging's settings with no `BETTER_AUTH_SECRET`, so every `/api/auth/*` request answers 503 `AUTH_UNAVAILABLE`, and Playwright would reuse it.

## 4. Drive the feature

`E2E_SERVER=preview E2E_PORT=<port> pnpm test:e2e --project=phone` starts a preview with no `--env`, as CI does, runs the Playwright journeys in `e2e/` on a phone (Pixel 7) and stops the preview. Sign-in works there, with a throwaway secret and Cloudflare's test Turnstile keys. Drop `--project=phone` to add a touch tablet (iPad size) and the desktop project (1440×900, a mouse), which runs only `e2e/desktop.spec.ts`: a computer gets the product page, not the app (#199). Playwright sends the password from `.dev.vars` with `httpCredentials`. Name a spec file to run one, such as `e2e/record-melodic.spec.ts` (Record).

For a new feature, add a spec in `e2e/`. To record, call `withFakeMicrophone('<file>.wav')` from `e2e/record.ts` with a Recording in `fixtures/recordings/` (090 is Melodic, G3; 084 is two farts; 065 is Noise-like), then `recordAndSave(page, seconds)`. Assert note names, not exact pitches.

To tap through by hand, start the same preview yourself with `pnpm exec opennextjs-cloudflare preview --port <port>`, and stop it as in step 6. For a quicker inner loop with no gate and no Workers build, `pnpm dev --port <port>`, or `E2E_PORT=<port> pnpm test:e2e`, which starts its own `next dev`.

## 5. Screenshot at phone size

Write a throwaway spec, `e2e/shot.spec.ts` (delete it before committing), that drives the feature and ends with `await page.screenshot({ path: '../../tmp/agent/<name>.png' })`. For Record: `withFakeMicrophone('090__carlosramon__17-pet__186119.wav')`, `recordAndSave(page, 1.5)`, wait for `getByTestId('result-note')`, then screenshot. Run `E2E_SERVER=preview E2E_PORT=<port> pnpm test:e2e e2e/shot.spec.ts --project=phone`, then open the image and look at it: it is the proof for a UI change.

## 6. Clean up

Playwright stops the previews it starts. Stop one you started yourself, from `apps/web`. The port's listener is `workerd`, and its parent stops the whole chain; stopping `workerd` alone leaves the rest running. The folder check leaves another session's server alone.

```sh
PORT=<port>
for p in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN); do
  if [ "$(lsof -a -p $p -d cwd -Fn | sed -n 's/^n//p')" = "$(pwd -P)" ]; then kill $(ps -o ppid= -p $p); fi
done
```

It's stopped when the `lsof` from step 1 prints nothing. Leave `tmp/agent/` for the PR; `.dev.vars` and `tmp/` are git-ignored.

Never use `pkill -f` on this shared machine. It matches its text against every process of this user, in every session and app: on 2026-11-06 one ended helpers in Chrome, Slack, VS Code and Bitwarden, and appears to have stopped 5 other sessions.

## Finish

`pnpm check` (lint, types, tests, build) on the PR's head commit is the finish gate. Cite its result in the PR; `web.yml` runs the checks again once the PR is ready.

Which change needs which evidence is in `apps/web/AGENTS.md`. Only the owner's phone proves the microphone, audio and install.
