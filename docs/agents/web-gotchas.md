# Web app gotchas

What the web app taught its builders, kept so the next change doesn't relearn it.

## Learned in slice 1

- `apps/web` isn't `"type": "module"`, so Playwright compiles `e2e/` as CommonJS. Use `__dirname`, not `import.meta`.
- Biome treats any function named `use…` as a React hook. That's why the fake-microphone helper is `withFakeMicrophone`.
- Chromium's fake microphone: `--use-file-for-fake-audio-capture=<wav>%noloop` plays the file once. It needs a PCM WAV. Fixtures 090 (G3), 084 (G♯3, two farts) and 065 (Noise-like) are the e2e cases. It plays from the moment the stream opens, before the app captures, so a take loses the file's first tens of ms (60 ms on CI). That cost 094, which is loud from 8 ms, its steady note (#141). A spec whose farts must start whole uses `e2e/fake-microphone.ts`, which plays each fart as Record is pressed, and `waitForOpenMicrophone`, which waits for the app's capture processor rather than getUserMedia (#172).
- Accounts in the journeys (#155): a guest's Toots last only the visit (their Recordings are kept: owner, 2026-10-25, #203), so a spec whose Toots outlast a relaunch signs in first (`signInByApi` in `e2e/account.ts`, with the code from `/dev/mail/`). Locally every request comes from 127.0.0.1, one client with 10 codes in 10 minutes, so `ownClient` gives each test its own `cf-connecting-ip`, which Miniflare passes through. `skipWelcome` and `recordAndSave` (`e2e/record.ts`) keep the account step out of the way unless a spec asks for it.
- Through the fake microphone, 4 of 5 Melodic fixtures give a Recording Pitch identical to golden. 094 (low confidence) comes out 20 cents high, still B3. Expect small differences on re-recorded audio. Assert note names, not exact MIDI.
- V8's `2 ** x` and `Math.log2` differ from numpy by an ulp on some pYIN bins. `analysis/numeric.ts` has correctly rounded `exp2` and `log2`. Use them, or bit-identity breaks.
- The timing tests need `fileParallelism: false` (`vitest.config.mts`).
- Safari mutes Web Audio when the silent switch is on unless `navigator.audioSession.type = 'playback'` is set (`context.ts`). The microphone needs `'play-and-record'` while it's open, which is from the first time Record shows to the end of the launch (`keepMicrophoneOpen`), so sounds play in it then too (`setPlaybackSession`).
- The Welcome icon uses `next/image` with `unoptimized`, because Workers has no image optimizer.
- 16-bit WAV: encode as `round(x × 32768)`, clamped, and decode as `/32768`, as other decoders do.
- A page prerendered by `generateStaticParams` is served on Workers from the static-assets incremental cache (`open-next.config.ts`), which `opennextjs-cloudflare preview` and `deploy` fill. Without it, such a page 404s on Workers though `next build` lists it. `/compose/[song]/` is prerendered with `dynamicParams = false`, so the service worker can keep each Song's page (`/shell.json`), and an unknown Song 404s.
- Both Web Workers load one Turbopack script, each with its own chunks in the URL's fragment (`#params=`), and a worker runs what its script's response URL says. The service worker keeps a copy with no URL, or a worker started offline runs the other worker's chunks.
- Playwright's `evaluate` counts as a tap, and Chromium gives every page Playwright loads the activation of one. To test a page that was never tapped, override `UserActivation.prototype.hasBeenActive` in an init script, as `song-creator.spec.ts` does.
- `decodeAudioData` detaches the `ArrayBuffer` it's given. Pass it a copy (`wav.slice(0)`) of audio you still need, as Song Creator does with a Toot it hasn't saved.
- `cloudflare-env.d.ts` types the bindings for `getCloudflareContext()`. Regenerate it with `pnpm cf-typegen` after any change to bindings or vars; `pnpm typecheck` fails while it's out of date. It declares the Workers runtime's globals over the DOM's, so browser code sometimes needs the DOM's own form, such as `window.addEventListener` or `appendChild`.

## Shell gotchas

- zsh has `noclobber` set: overwrite a file with `>|`, and use `bash -c` for `set -- $words` loops.
- To call `gh.sh` through a variable, keep only its path in it: `G=~/.claude/skills/serp-github-app/scripts/gh.sh; bash $G pr view <n>`. zsh doesn't word-split `$G`, so `G="bash <path>"; $G ...` fails: zsh looks for one command named `bash <path>`. Writing the whole `bash ~/.claude/skills/serp-github-app/scripts/gh.sh ...` call, as this page does, works too.
