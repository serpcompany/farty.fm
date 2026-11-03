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
- The tabs wait, not responding, while Getting the mic ready, Recording, the review, Result, a saved
  Recording's review or the account step shows (`e2e/record-states.spec.ts`, "Getting the mic ready
  until audio reaches the page, then the red Recording screen"; `e2e/lander.spec.ts`, "Recording,
  Review and Result are a card under the top bar, whose tabs wait for them"; "Sign up free opens the
  account step under the top bar, whose tabs wait for it";
  `src/components/farty/app-shell.interaction.test.tsx`, "wait while a saved Recording's review is
  open"; `e2e/record-noise.spec.ts`, "a Recording's review is a modal: focus moves in and stays in,
  Escape is Cancel, focus goes back (#314)").
- A shared link's page and a profile page have no tabs, only a top bar of their own
  ([Pages outside the tabs](#pages-outside-the-tabs)).
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
- A database from before Recordings had names upgrades and keeps its Recordings and Favorite Songs
  (`e2e/database-upgrade.spec.ts`, "upgrades a database from before names and keeps its Recordings
  and Favorite Songs").
- The database is at version 8, and each upgrade keeps everything the last held. Versions 4, 6, 7
  and 8 each close a tab still on an older build, which then can't open the library again, so that
  build never sends a change it doesn't understand: a placement by ear as a delete (4), a placement
  without its Trim (6), a Favorite Song it doesn't know (7), or a placement without the name, or a Recording left out with
  No note played in Songs (8). Each
  reads the account's whole library once, bringing what such a tab skipped
  (`src/lib/database-upgrade.test.ts`, "keeps Recordings, Toots, their WAVs, the outbox and what
  waits to download"; "closes a tab’s version 3 connection, which then can’t open the library
  again"; "reads the whole library once: an older tab skipped placements and moved the cursor past
  them"; "leaves a guest's library without a cursor"; "reads the whole library once, for the Trims
  an older tab dropped, and shuts that tab out"; "sends a place queued by version 5 code as the
  Placed Pitch alone, keeping the Trim"; "adds the Favorite Songs, keeps the rest, reads the whole
  library once and shuts out older tabs"; "keeps the Favorite Songs and their queue, reads the names
  once and shuts out older tabs"; `src/lib/outbox-send.test.ts`, "never sends an op from a later
  build that it doesn’t know, and keeps it queued, as code from before #268 sent a place as a
  delete").
- Signing out in one tab clears the others, without a reload ([Accounts](account.md)).

## When the library won't open

Each replaces the tab's screen with a message and a Reload button.

- A newer Farty saved the library: "Farty was updated" (`e2e/database-upgrade.spec.ts`, "says
  Farty was updated when a newer Farty saved the library";
  `src/components/farty/recordings-provider.interaction.test.tsx`, "says Farty was updated when a
  newer Farty saved the library, and reports it").
- The browser won't let Farty read its storage: "Farty can’t open your library"
  (`src/components/farty/recordings-provider.interaction.test.tsx`, "says the library can’t be
  opened when the browser won’t let Farty read it").
- The privacy, support and 404 pages need no library, so they still show
  (`src/components/farty/app-shell.interaction.test.tsx`, "still shows the %s page, which needs no
  library").
- A connection to the database that the browser drops mid-visit, closed by the browser or lost
  without a word, is opened again, and the save that met it still works
  (`e2e/library-connection.spec.ts`, "saving a Recording still works (${announced ? 'closed by the
  browser' : 'lost without a word'})";
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
- The privacy page says what an account stores, that Farty news is on by default, that the account
  step loads Cloudflare Turnstile, that a guest's farts last only until Farty closes, what error
  reports and page views hold, and how to delete it all (`e2e/pages.spec.ts`, "the privacy page
  covers accounts, news email, Turnstile, guests, error reports, page views and deleting").
- The support page has a way to get in touch (`e2e/pages.spec.ts`, "the support page has a way to
  get in touch").
- A made-up address answers 404 with "Page not found" and Back to Farty, on no tab
  (`e2e/pages.spec.ts`, "a made-up URL answers 404 with one noindex tag and a link home").
- A shared link's page and a profile page (`/u/`) have no tabs: their own top bar has Farty and Get
  Farty, or Open Farty for someone signed in, and the account step covers all of them
  (`src/components/farty/app-shell.interaction.test.tsx`, "are not on a shared link's page, which
  has its own top bar"; `e2e/share-recording.spec.ts`, "a signed-in user shares a Recording,
  someone signed out plays it, and Stop sharing takes the link down";
  `src/components/farty/account-step.interaction.test.tsx`, "covers all of a shared page, which
  has no app top bar to leave room for"). What they show is in [Sharing](sharing.md),
  [Friends](friends.md) and [Get Farty](get-farty.md).

## Accessibility

- The first visit, every tab, a locked Song's page, the Sound Pad and a Pad's chooser, Record's
  Getting the mic ready and red Recording screens, the pages outside the tabs, a profile page and a
  shared Recording's and Toot's pages meet WCAG 2.1 AA, in light and dark, on a phone and a touch
  tablet, and so does the product page on a computer (`e2e/accessibility.spec.ts`, "the first visit meets WCAG 2.1 AA";
  "${path} meets WCAG 2.1 AA"; "the Sound Pad and a Pad's chooser meet WCAG 2.1 AA"; "Record's
  Getting the mic ready screen meets WCAG 2.1 AA"; "Record's red Recording screen meets WCAG 2.1
  AA"; "the pages outside the tabs meet WCAG 2.1 AA"; "a profile page, and a shared Recording's and
  Toot's pages, meet WCAG 2.1 AA"; `e2e/desktop.spec.ts`, "the product page meets WCAG 2.1 AA, in
  light and dark"). Where axe can't tell a text's background, such as the product page's gradient,
  the journeys measure the contrast from the pixels under the text.
- With reduced motion asked for, nothing but a spinner moves for longer than a frame
  (`e2e/accessibility.spec.ts`, "with reduced motion, nothing but a spinner moves for longer than a
  frame"). A playing Toot's playhead hides (`e2e/song-creator.spec.ts`, "plays each Song with your
  farts, plays a tapped note, and saves it as a Toot"), and so does a playing Recording's, on its
  row, in its review and on its shared page, while the bars it has passed still fill; a scrub's
  playhead still follows the finger (`e2e/record-noise.spec.ts`, "a Noise-like fart can be trimmed
  in its review, and the row then plays just that part (ADR 0019)").

## Staging and Production

- Staging asks for a password before any page. Production never does (`src/lib/staging-access.test.ts`,
  "asks for the password, and serves nothing, when a request has none"; "serves Production with no
  gate and no noindex, even given a wrong password"). The gate is in
  [Staging access](../../../../docs/agents/staging-access.md).
- Staging alone has the Fixture Library ([Profile](profile.md#internal-build-the-fixture-library)),
  saving a Toot costs $0.99 on both, in Stripe's test mode on Staging and live mode on Production
  ([Paying to save a Toot](payments.md)), and Staging signs up only the emails on its list
  ([Accounts](account.md)).
- `/dev/telemetry/` sends a synthetic crash and handled error on Staging and a local run, and is
  not found on Production (`src/app/dev/telemetry/page.test.tsx`, "is not found in Production";
  `e2e/telemetry.spec.ts`, "the synthetic triggers are not found").
- The dev mailbox (`/dev/mail/`) and the dev checkout (`/dev/checkout/`) answer only a local run on
  a local host (`src/server/email.test.ts`, "is open only to a local run, on a local host";
  `src/app/api/payments.workers.test.ts`, "has no dev checkout off this machine, or with a Stripe
  key").

## Not checked

- From 768px the waiting tabs look dimmed, as well as not responding.
