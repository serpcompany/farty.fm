# App shell

What frames every area: the tabs, what happens when Farty comes back to the screen, Farty open in
other tabs, the screens that stand in for a tab when something is wrong, a new deploy, the pages
outside the tabs, and where Staging differs. Welcome and the lander are in
[First visit](first-visit.md).

## The tabs

- Five tabs, in this order: Recordings, Compose, Record, Toots, Profile. Record is in the center and
  Farty opens on it. Each tab works before the first Recording (`e2e/tabs.spec.ts`, "the app opens
  on Record, and every tab works before the first Recording"; `src/lib/tabs.test.ts`, "are the
  iPhone app's five, in its order, with Record in the center").
- Song Creator counts as Compose and a Toot's screen as Toots. The privacy, support and 404 pages
  are on no tab (`src/lib/tabs.test.ts`, "%j is on %s"; "%j is on no tab").
- On a phone the tabs are along the bottom. From 768px they are a bar along the top, with Farty's
  name, and the record flow and the account step open as a card under it (`e2e/lander.spec.ts`,
  "Recording, Review and Result are a card under the top bar, whose tabs wait for them").
- While the record flow or the account step is open, the tabs don't respond (`e2e/lander.spec.ts`,
  "Recording, Review and Result are a card under the top bar, whose tabs wait for them"; "Sign up
  free opens the account step under the top bar, whose tabs wait for it").
- Changing tabs stops whatever plays (`e2e/tabs.spec.ts`, "a Recording shows on the Recordings tab
  with its note, and playback stops on a tab change").

## Coming back to Farty

- Hiding the page stops whatever plays. On a phone or a touch tablet, Farty opens Record when it
  shows again (`e2e/tabs.spec.ts`, "a Recording shows on the Recordings tab with its note, and
  playback stops on a tab change"; `src/components/farty/back-on-record.interaction.test.tsx`, "opens Record after another app").
- It stays where it was on Record, on a page outside the tabs, and while the record flow is open
  (`src/components/farty/back-on-record.interaction.test.tsx`, "stays where it was on Record, outside the tabs, or while the flow or account step is
  open").
- It stays where it was when the browser left for another page, such as the checkout page, and
  came back with Back (`src/components/farty/back-on-record.interaction.test.tsx`, "stays where it was after the browser leaves for another page, such
  as the checkout page, and comes back with Back"). The next return from another app opens Record
  again (`src/components/farty/back-on-record.interaction.test.tsx`, "opens Record after another app that follows a return from another page").
- It stays where it was while the account step is open, so a person can read their email for the
  code (`e2e/account-step.spec.ts`, "Profile's Save to an account opens the step, which stays while
  they read their email").
- On a computer the product page stays where it was (`e2e/desktop.spec.ts`, "coming back to the
  page leaves the product page where it was"; `src/components/farty/back-on-record.interaction.test.tsx`, "stays where it was").

## Farty in other tabs

- A tab still holding an older version of the browser's database holds up the upgrade. Until it
  closes, the others say "Close Farty in your other tabs to carry on." and show no library
  (`e2e/database-upgrade.spec.ts`, "asks you to close Farty in your other tabs while one holds the
  old database open").
- A database from before Toots upgrades and keeps its Recordings and their numbers
  (`e2e/database-upgrade.spec.ts`, "upgrades a database from before Toots and keeps its
  Recordings").
- Signing out in one tab clears the others, without a reload ([Accounts](account.md)).

## When the library won't open

Each replaces the tab's screen with a message and a Reload button.

- A newer Farty saved the library: "Farty was updated" (`src/components/farty/recordings-provider.interaction.test.tsx`,
  "says Farty was updated when a newer Farty saved the library, and reports it").
- The browser won't let Farty read its storage: "Farty can’t open your library"
  (`src/components/farty/recordings-provider.interaction.test.tsx`, "says the library can’t be
  opened when the browser won’t let Farty read it").
- The privacy, support and 404 pages need no library, so they still show
  (`src/components/farty/app-shell.interaction.test.tsx`, "still shows the %s page, which needs no
  library").
- A connection to the database that the browser drops mid-visit is opened again, and the save that
  met it still works (`e2e/library-connection.spec.ts`, "saving a Recording still works (lost
  without a word)"; "saving a Recording still works (closed by the browser)";
  `src/lib/recording-store.test.ts`, "a retried save finds the Recording its first try saved,
  unheard, and keeps one").

## When a screen breaks

- A screen that throws shows "Something went wrong", "Reload Farty to carry on." and Reload, and
  reports `uncaught-error`. A broken root layout gets a whole page of its own
  (`src/app/error.interaction.test.tsx`, "report what broke the screen, by a stable code"; "reload
  Farty when Reload is tapped"; "give a broken root layout a whole page of its own").
- Errors are reported by a stable code and never their message, and wait on the device while
  offline. Profile's switch turns them off ([Profile](profile.md#privacy)). What a report holds is
  in [the web app guide](../../../../docs/agents/web.md#exceptions-to-serps-standards).

## A new deploy

- Pages come from the network first, so a deploy shows on the next navigation
  (`src/lib/service-worker.test.ts`, "fetches pages from the network first, and answers from the
  cache offline").
- A tab opened before a deploy that then fails to load an older build's script reloads once, at most
  once in 10 minutes, and waits while an unsaved Recording or Toot is on screen
  (`e2e/stale-build.spec.ts`, "reloads the page once, after the unsaved Recording is gone";
  `src/lib/stale-build.test.ts`, "waits while something unsaved is on screen, and comes once the
  last hold lets go"; "comes at most once in the guard, so a build that keeps failing never loops";
  "never comes when the tab has nowhere to note it";
  `src/components/farty/song-creator.interaction.test.tsx`, "holds off a new build until the Toot is
  saved").
- The service worker answers such a script with the copy it kept ([Installing and
  offline](install.md#offline)).

## Pages outside the tabs

- `/privacy/` and `/support/` are plain pages with no tabs. Welcome and the lander never cover them,
  or the 404 page (`e2e/desktop.spec.ts`, "the privacy, support and 404 pages stay pages, with no
  tabs"; `e2e/pages.spec.ts`, "Welcome, or from 768px the lander, shows on a first visit but never
  covers the privacy, support or 404 page").
- The privacy page says what an account stores, that Farty news is on by default, what a guest
  keeps, what error reports and page views hold, and how to delete it all (`e2e/pages.spec.ts`,
  "the privacy page covers accounts, news email, guests, error reports, page views and deleting").
- The support page has a way to get in touch (`e2e/pages.spec.ts`, "the support page has a way to
  get in touch").
- A made-up address answers 404 with "Page not found" and Back to Farty, on no tab
  (`e2e/pages.spec.ts`, "a made-up URL answers 404 with one noindex tag and a link home").

## Accessibility

- The first visit, every tab, a locked Song's page and the pages outside the tabs meet WCAG 2.1
  AA, in light and dark, on a phone and a touch tablet, and so does the product page on a computer
  (`e2e/accessibility.spec.ts`, "the first visit meets WCAG 2.1 AA"; "${path} meets WCAG 2.1 AA";
  "the pages outside the tabs meet WCAG 2.1 AA"; `e2e/desktop.spec.ts`, "the product page meets
  WCAG 2.1 AA, in light and dark"). Where axe can't tell a text's background, such as the product
  page's gradient, the journeys measure the contrast from the pixels under the text.
- With reduced motion asked for, nothing but a spinner moves for longer than a frame
  (`e2e/accessibility.spec.ts`, "with reduced motion, nothing but a spinner moves for longer than a
  frame").

## Staging and Production

- Staging asks for a password before any page. Production never does (`src/lib/staging-access.test.ts`,
  "asks for the password, and serves nothing, when a request has none"; "serves Production with no
  gate and no noindex, even given a wrong password"). The gate is in
  [Staging access](../../../../docs/agents/staging-access.md).
- Staging alone has the Fixture Library ([Profile](profile.md#internal-build-the-fixture-library)),
  saving a Toot costs $0.99 on Staging and is free on Production ([Paying to save a
  Toot](payments.md)), and Staging signs up only the emails on its list ([Accounts](account.md)).
- `/dev/telemetry/` sends a synthetic crash and handled error on Staging and a local run, and is
  not found on Production (`src/app/dev/telemetry/page.test.tsx`, "is not found in Production";
  `e2e/telemetry.spec.ts`, "the synthetic triggers are not found").
- The dev mailbox (`/dev/mail/`) and the dev checkout (`/dev/checkout/`) answer only a local run on
  a local host (`src/server/email.test.ts`, "is open only to a local run, on a local host";
  `src/app/api/payments.workers.test.ts`, "has no dev checkout off this machine, or with a Stripe
  key").
