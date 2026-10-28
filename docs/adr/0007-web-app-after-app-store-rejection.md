# A web app, because the App Store won't take a fart app

Apple rejected Pedos 1.0.0 on 2026-10-06 (#75) under guideline 4.3(b): it is primarily a fart app. The current guideline lists fart and burp apps as adding no value to the App Store, with no exception for a unique experience, and warns that repeated submissions of this kind can lead to removal from the Apple Developer Program. It was also rejected under 1.1.1, with no detail given.

The product owner decided the same day to keep the fart concept and leave the App Store. Pedos becomes a web app in `apps/web/`, built on the SERP web-stack standard: Next.js on Cloudflare Workers, shadcn, pnpm, Biome, Vitest and Playwright. It works on iPhone (Safari, then Add to Home Screen), Android and desktop.

This replaces ADR 0001's platform choice, a native SwiftUI app distributed through TestFlight. The rest of ADR 0001 stands: no accounts, no cloud libraries, no sync. Recordings, their analysis and Toots stay in the browser, in IndexedDB.

## Why

The routes the owner weighed (#106):

| Route | Reach | Why not |
|---|---|---|
| App Store, repositioned as "any sound becomes a song" | Every iPhone | It means hiding what the app is for, and every rejected resubmission risks the developer account. |
| App Store, appeal as is | Every iPhone | 4.3(b) gives fart apps no exception, and an appeal doesn't fix 1.1.1. |
| Alternative app stores (EU, Japan), notarized only | Users in those regions who install another store first | Too small an audience. The EU also needs trader status, which the owner skipped. |
| TestFlight | 100 internal testers; external testers need Beta App Review against the same guidelines | Not a public release. |
| Google Play | Android only | Loses iPhone users. It needs a Kotlin rewrite, and new accounts must run a 14-day closed test. |
| **Web app (chosen)** | Every phone and computer | Needs a rebuild in TypeScript, but has no store review. |

## Consequences

- **Never resubmit Pedos as a fart app** to the App Store or to external TestFlight. The Swift app stays in `ios/`, but it isn't released anymore: the owner stopped TestFlight builds on 2026-10-06 (#103), and its issues are closed.
- The engine is ported again, this time to plain TypeScript: no Web Audio processing, so the same code runs in a browser Web Worker and in Vitest. The port is checked against `fixtures/golden/`, like the Swift port. ADRs 0002 to 0006 apply to it unchanged.
- The browser records raw PCM with its voice processing off (no echo cancellation, noise suppression or gain control), because those would bend a fart's pitch and level. Recordings are kept as 16-bit WAV.
- Safari mutes Web Audio when the iPhone's silent switch is on, unless the page sets Safari's Audio Session to playback. The app does.
- A browser may clear a site's storage. Asking for persistent storage and Add to Home Screen come in #109 and #112.

Update 2026-10-27: accounts, a cloud library and sync replace "no accounts, no cloud libraries, no sync" (ADR 0015). Google Play is planned as a Trusted Web Activity of this web app ([Google Play](../agents/google-play.md)), not the Kotlin rewrite the table above assumed.
