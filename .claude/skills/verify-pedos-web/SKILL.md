---
name: verify-pedos-web
description: Prove a Pedos web feature works before review - start the app, check it is healthy, drive the feature with Playwright and a fixture as the fake microphone, take phone-size screenshots, and clean up. Use before marking a web PR ready, or when asked to tap through, verify or screenshot a web change.
---

# Verify the Pedos web app

Run from `apps/web/`. Proof goes in `tmp/agent/` (git-ignored) and the PR cites it. Never run `pnpm deploy:*`: CI deploys Staging.

Agents run every `gh` command, and every `git` command that reaches GitHub, as serp-agent through the `serp-github-app` skill ([Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md)).

## 1. Start the app

Use your own port so parallel agents don't collide. The examples use 4109.

- **Inner loop:** `pnpm dev` (http://localhost:3000, no gate). `pnpm test:e2e` starts its own `next dev` on `E2E_PORT` (default 3100).
- **Tap-through, on the local Workers build behind the Staging gate:**
  1. `cp .dev.vars.example .dev.vars` (git-ignored; it holds Staging's public password, `stagingpassword`).
  2. `pnpm build:staging`
  3. `mkdir -p ../../tmp/agent && pnpm exec opennextjs-cloudflare preview --env staging --port 4109 >| ../../tmp/agent/preview.log 2>&1 &` (`>|` so a rerun overwrites the log under zsh's `noclobber`).

## 2. Check it is healthy

`bash scripts/smoke.sh http://localhost:4109 staging` must print no `FAIL` line. It checks the pages and icons, the microphone permission, and the gate (401 without the password, and `noindex` dropped with it).

## 3. Drive the feature

`E2E_SERVER=preview E2E_PORT=4109 pnpm test:e2e` runs the Playwright journeys in `e2e/` against that preview, at desktop and phone (Pixel 7) size. It sends the password from `.dev.vars` with `httpCredentials`. Name a spec file to run one, such as `e2e/record-melodic.spec.ts` (Record).

For a new feature, add a spec in `e2e/`. To record, call `withFakeMicrophone('<file>.wav')` from `e2e/record.ts` with a Recording in `fixtures/recordings/` (090 is Melodic, G3; 084 is two farts; 069 is Noise-like), then `recordAndSave(page, seconds)`. Assert note names, not exact pitches.

## 4. Screenshot at phone size

Write a throwaway spec, `e2e/shot.spec.ts` (delete it before committing), that drives the feature and ends with `await page.screenshot({ path: '../../tmp/agent/<name>.png' })`. For Record: `withFakeMicrophone('090__carlosramon__17-pet__186119.wav')`, `recordAndSave(page, 1.5)`, wait for `getByTestId('result-note')`, then screenshot. Run `E2E_SERVER=preview E2E_PORT=4109 pnpm test:e2e e2e/shot.spec.ts --project=phone`, then open the image and look at it: it is the proof for a UI change.

## 5. Clean up

Stop the preview: `pkill -f 'preview --env staging --port 4109'`. Leave `tmp/agent/` for the PR; `.dev.vars` and `tmp/` are git-ignored.

## Finish

`pnpm check` (lint, types, tests, build) on the PR's head commit is the finish gate. CI checks are off until #113, so cite its result in the PR.

Which change needs which evidence is in `apps/web/AGENTS.md`. Only the owner's phone proves the microphone, audio and install.
