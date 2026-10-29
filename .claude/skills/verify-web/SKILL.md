---
name: verify-web
description: Prove a Farty web feature works before review - start the app, check it is healthy, drive the feature with Playwright and a fixture as the fake microphone, take phone-size screenshots, and clean up. Use before marking a web PR ready, or when asked to tap through, verify or screenshot a web change.
---

# Verify the Farty web app

Run from `apps/web/`. Keep proof in `tmp/agent/` (git-ignored) while you work. The PR says what ran and what it showed, and attaches screenshots through GitHub: readers can't open a local path, and the pull request's text check refuses one. Never run `pnpm deploy:*`: CI deploys Staging.

Agents run every `gh` command, and every `git` command that reaches GitHub, as serp-agent through the `serp-github-app` skill ([Agent GitHub Identity](https://github.com/serpcompany/serp/blob/main/docs/engineering/standards/agent-harness/agent-github-identity.md)).

## 1. Start the app

Use your own ports so parallel agents don't collide. The examples use 4109 and 4110.

On Windows, run the Workers build and every step after it in Linux, since a Worker built on Windows answers 500 ([Tapping through](../../../docs/agents/web.md#tapping-through)): prefix each command with `bash scripts/linux.sh`, and set `LINUX_PORT=<port>` on a preview you start yourself so the host can reach it.

- **Inner loop:** `pnpm dev` (http://localhost:3000, no gate). `pnpm test:e2e` starts its own `next dev` on `E2E_PORT` (default 3100).
- **Tap-through, on the local Workers build behind the Staging gate:**
  1. `cp .dev.vars.example .dev.vars` (git-ignored; it holds Staging's public password, `stagingpassword`).
  2. `pnpm build:staging`, then `pnpm db:migrate:local`.
  3. Start a preview as its own long-running task (a background task, or another terminal), not with `&` in a one-off shell: `pnpm exec opennextjs-cloudflare preview --env staging --port 4109` for the smoke test, and `pnpm exec opennextjs-cloudflare preview --port 4110` for the journeys, screenshots and tapping through. With `--env staging` the preview has the branded origin and no `BETTER_AUTH_SECRET`, so sign-in answers 503 there.

## 2. Check it is healthy

`bash scripts/smoke.sh http://localhost:4109 staging` must print no `FAIL` line. It checks the pages and icons, the microphone permission, and the gate (401 without the password, and `noindex` dropped with it).

## 3. Drive the feature

`E2E_SERVER=preview E2E_PORT=4110 pnpm test:e2e` runs the Playwright journeys in `e2e/` against the preview with no `--env` (it starts one on that port if none is running), on a touch tablet (iPad size) and a phone (Pixel 7). The desktop project (1440×900, a mouse) runs only `e2e/desktop.spec.ts`: a computer gets the product page, not the app (#199). It sends the password from `.dev.vars` with `httpCredentials`. Name a spec file to run one, such as `e2e/record-melodic.spec.ts` (Record).

For a new feature, add a spec in `e2e/` that imports `test` and `expect` from `./test`, not `@playwright/test` (Biome refuses those): it fails a journey on any console error or page error the journey doesn't name with `pageErrors.expect(...)`. To record, call `withFartingMicrophone()` from `e2e/record.ts`: it puts a fake microphone in every page the test opens, which plays a Recording from `fixtures/recordings/` as Record is pressed (`e2e/fake-microphone.ts` lists them: 090 is Melodic, G3; 084 is two farts; 065 is Noise-like). Then `recordAndSave(page, '<id>')` opens Record, farts and saves. Assert note names, not exact pitches.

## 4. Screenshot at phone size

Write a throwaway spec, `e2e/shot.spec.ts` (delete it before committing), that drives the feature and ends with `await page.screenshot({ path: '../../tmp/agent/<name>.png' })`. For Record: `withFartingMicrophone()`, `recordAndSave(page)` (090 by default), wait for `getByTestId('result-note')`, then screenshot. Run `E2E_SERVER=preview E2E_PORT=4110 pnpm test:e2e e2e/shot.spec.ts --project=phone`, then open the image and look at it: it is the proof for a UI change, attached to the PR.

## 5. Clean up

Stop each preview you started by ending its task (or Ctrl+C in its terminal). `.dev.vars` and `tmp/` are git-ignored.

## Finish

`pnpm check` (lint, types, tests, build) on the PR's head commit is the finish gate. Cite its result in the PR; `web.yml` runs the checks again once the PR is ready.

Which change needs which evidence is in `apps/web/AGENTS.md`. Only the owner's phone proves the microphone, audio and install.
