# Installing and offline

Farty installs from the browser to the Home Screen and opens offline once installed. This page
covers the install offer after the first Recording, Profile's guide, the manifest, what works
offline, and keeping the browser's storage. How the service worker works is in
[ARCHITECTURE.md](../../../../ARCHITECTURE.md#offline-the-service-worker). The Play app wraps the
same site ([Google Play](../../../../docs/agents/google-play.md)).

## The install offer

- After the first saved Recording, once the record flow closes, a card offers "Install Farty",
  once. On iPhone it says to tap Share, then Add to Home Screen. Close hides it, and it doesn't come
  back after a reload (`e2e/install.spec.ts`, "after the first saved Recording, says how to add
  Farty to the Home Screen, once").
- Where Chrome offers its install prompt, the card has Install app, which opens it, and the card
  hides once Farty is installed (`e2e/install.spec.ts`, "after the first saved Recording, offers
  Chrome’s install prompt"; "hides the offer once Farty is installed").
- It offers nothing where Farty can't be added to the Home Screen from the page, or once Farty runs
  from the Home Screen (`src/lib/install.test.ts`, "offers nothing where Farty can't be added to the
  Home Screen"; "offers nothing once Farty runs from the Home Screen"; "uses the Share sheet on
  iPhone and iPad, in Safari and the browsers built on it"; "uses Chrome's prompt once Chrome offers
  it").

## Profile's guide

Get the app, on Profile, says how to install in the browser at hand.

- iPhone and iPad Safari: three steps through the Share sheet, and a tip for stopping Safari asking
  for the microphone (Page Menu, Website Settings, Microphone: Allow). An iPad that says it's a Mac
  is known by touch (`e2e/profile.spec.ts`, "says how to add Farty to the Home Screen from the Share
  sheet").
- An iPhone in-app browser: open the page in Safari first, with no microphone tip
  (`e2e/profile.spec.ts`, "says to open the page in Safari first").
- Android, before Chrome offers its prompt: three steps through the browser's menu
  (`e2e/profile.spec.ts`, "says to install from the browser's menu before Chrome offers its
  prompt").
- Once Chrome offers its prompt: Install app opens it, and Profile says once Farty is installed
  (`e2e/profile.spec.ts`, "Install app opens Chrome's prompt, and Profile says once Farty is
  installed").
- Samsung Internet: steps through its own menu (`e2e/profile.spec.ts`, "says to add Farty from
  Samsung Internet's menu").
- An Android in-app browser: open the page in the browser first (`e2e/profile.spec.ts`, "says to
  open the page in the browser first").
- Opened from the Home Screen, on iPhone or Android: "Farty is installed"
  (`e2e/profile.spec.ts`, "says Farty is installed when it opens from the Home Screen").
- A computer: "Farty is a phone app", and to open the page on a phone (`e2e/profile.spec.ts`, "says
  Farty is a phone app").
- Each case is also checked from the browser's user agent alone (`src/lib/install.test.ts`, "sends
  an iPhone's in-app browsers to Safari first"; "uses the browser's menu on Android until Chrome
  offers its prompt"; "sends Android's in-app browsers to the browser first"; "says to open Farty on
  a phone from a computer"; "says Farty is installed once it runs from the Home Screen").

## The manifest

- The manifest names Farty, opens it full screen from `/`, has its icons at 192 and 512 pixels for
  any use and as maskable, and Chrome finds the site installable. It's fetched with credentials, so
  Staging's password doesn't block it (`e2e/install.spec.ts`, "the manifest names Farty, opens it
  full screen, and has its icons").

## Offline

The service worker registers only in a build, never on `pnpm dev`.

- Installed, Farty opens offline: the start page and every tab, even one never visited
  (`e2e/install.spec.ts`, "the service worker opens the app shell offline";
  `src/lib/service-worker.test.ts`, "keeps the start page, the tabs it links to, and the files they
  load when it installs, but not the lander's images").
- Each Song's page and a Toot's screen open offline, with the Web Workers that render and analyze
  (`src/lib/service-worker.test.ts`, "keeps each Song's page from /shell.json, and the files it
  loads, when it installs"; "keeps the scripts that the scripts load by name, such as the workers'
  chunks"; "answers a worker script offline with a copy that has no URL, so each worker keeps its
  own").
- Offline, a guest's Recordings are there and play, a Ready Song makes its Toot, and a saved Toot
  plays (`e2e/guest-visit.spec.ts`, "a guest's Recording is there when the installed app opens
  again offline"; `e2e/song-creator.spec.ts`, "the installed app opens a Ready Song offline, and
  makes its Toot"; `e2e/toots-kept.spec.ts`, "the installed app opens a Toot offline, and plays
  it").
- Online, pages come from the network first, so a deploy shows at once, and an online visit to the
  start page keeps a later deploy's tabs (`src/lib/service-worker.test.ts`, "fetches pages from the
  network first, and answers from the cache offline"; "keeps a later deploy's tabs, new and changed,
  after one online visit to the start page"; "tries the refresh again on the next start page when
  the connection drops part way").
- A script an older build loads, which a deploy has taken off the server, is answered with the copy
  kept (`e2e/stale-build.spec.ts`, "the service worker answers a 404 for a script it kept with its
  copy"; `src/lib/service-worker.test.ts`, "answers an older build's script with the copy it kept,
  once a deploy has taken it off the server").
- It never keeps audio, the Fixture Library or anything behind Staging's password, and a page that
  asks for that password lets the worker go, so the browser can ask for it
  (`src/lib/service-worker.test.ts`, "leaves the Fixture Library, audio, data, other sites and
  writes to the network"; "never keeps a response from the Staging password").

## Keeping the browser's storage

- Once there's a Recording, and on signing in, Farty asks the browser to keep its storage, so the
  Recordings aren't cleared to make room (`e2e/install.spec.ts`, "after the first saved Recording,
  says how to add Farty to the Home Screen, once"; `e2e/guest-visit.spec.ts`, "a guest's Recording
  outlasts closing Farty and still plays, while their Toot lasts the visit";
  `e2e/account-step.spec.ts`, "signing up from the first Result keeps the Recording, and goes where
  they tapped").

## Not checked

- The install offer never shows on a computer. Where Chrome offers its prompt there, only the
  `desktop` media query in `globals.css` hides the offer, and only a real browser applies CSS.
- That a Home Screen icon opens Farty, and the microphone on a real device: these need the owner's
  phone ([Evidence](../../AGENTS.md#evidence)).
