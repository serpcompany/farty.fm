# Profile

The Profile tab: the person's stats, their account, the Fixture Library on Staging, how to install
Farty, the error-report switch, and where the Songs come from. Its rows are each at least 44 CSS
pixels high (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and
deleted").

## Stats

- While they load, a spinner (`src/components/farty/profile-screen.interaction.test.tsx`, "shows a
  spinner while the stats load").
- Recordings, Melodic Recordings, Notes collected, Songs unlocked ("8 of 12") and Toots, from what
  this browser holds (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch,
  renamed, and deleted").
- With no Recordings, every stat is 0 and a line says "Record your first fart on the Record tab.
  Collect notes to unlock Songs." (`e2e/tabs.spec.ts`, "the app opens on Record, and every tab works
  before the first Recording"; `e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a
  relaunch, renamed, and deleted").

## Account

What the Account section shows depends on the account's state. Each action is in
[Accounts](account.md).

- While Farty reads the session, a spinner. When it can't reach the account: "Can't reach your
  account right now.", with Retry, and it reads it again by itself once the browser is back online
  (`e2e/account-profile.spec.ts`, "Profile retries an account it couldn't reach, and reads it again
  back online").
- A guest: Save to an account, and the line "Your farts are gone when you close Farty, unless you
  make a free account." (`e2e/account-step.spec.ts`, "Profile's Save to an account opens the step,
  which stays while they read their email").
- A session that ended: Sign in again, and Clear this device (`e2e/session-ended.spec.ts`, "an
  account's farts stay when its session ends: Farty asks to sign in again, or clears them").
- Signed in: the email, the Farty news switch, Sign out and Delete account
  (`e2e/account-profile.spec.ts`, "Profile's account: the email, Farty news, and Sign out, which
  leaves nothing here").
- Delete account with a sign-in 10 minutes old or more asks for a new email code first
  ([Accounts](account.md#signed-in-on-profile); `e2e/account-profile.spec.ts`, "Delete account
  after an old sign-in asks for a new code, then deletes the account").

## Internal build: the Fixture Library

On Staging's build only, for Internal Testers.

- An "Internal build" section has Load the Fixture Library and a count, "0 of 32". Loading adds the
  32 test farts as the person's own Recordings, analyzed like real ones, and loading again adds only
  the missing ones. Once all are in, it says "Fixture Library loaded" and is disabled
  (`e2e/fixture-library.spec.ts`, "loads the Fixture Library and unlocks every Song it is long
  enough for"; `src/components/farty/recordings-provider.interaction.test.tsx`, "adds files as
  Recordings with their ids, then analyzes each"; `src/lib/fixture-library.test.ts`, "has the 32
  fixtures of the golden library").
- A fixture deleted while signed in loads again and stays: everywhere but Production, the account
  takes a fixture's Recording again after it was deleted (`e2e/fixture-library.spec.ts`, "a fixture
  deleted from the account loads again, and stays"; `src/app/api/fixture-recordings.workers.test.ts`,
  "uploads again %s, with its audio, while any other deleted Recording stays deleted"; "stays
  deleted on Production, like every other Recording").
- A load that fails says "The Fixture Library didn’t load. Try again." and can be tried again
  (`e2e/fixture-library.spec.ts`, "says when the Fixture Library did not load, and lets you try
  again").
- Its Recordings analyze as the reference does and unlock the Songs it does
  (`src/lib/fixture-library.test.ts`, "analyzes as the reference does and unlocks the Songs it does,
  as 16-bit WAV").
- A build without it, as Production's is, has no Internal build section
  (`src/components/farty/profile-screen.interaction.test.tsx`, "has no Fixture Library in a build
  without it, as Production’s is").
- Signed in, they upload to the account like any Recording (`e2e/sync.spec.ts`, "two browsers
  signed in to one account play each other's farts, and see each other's deletes").

## Get the app

- A card says how to add Farty to the Home Screen in this browser, or that it's installed, or that
  it's a phone app. On iPhone and iPad Safari, a line under it says how to stop Safari asking for
  the microphone ([Installing and offline](install.md#profiles-guide)).

## Privacy

- Share anonymous error reports is on by default. Turned off, nothing is sent, waiting reports are
  dropped, and it stays off (`e2e/telemetry.spec.ts`, "with Profile's switch off, nothing is sent,
  and it stays off"; `src/lib/telemetry/errors.test.ts`, "turning the switch off drops the waiting
  reports").
- A browser that sends Global Privacy Control sees the switch off and disabled, with a line saying
  why, and sends nothing (`e2e/telemetry.spec.ts`, "with Global Privacy Control, nothing is sent and
  the switch shows off").
- The switch doesn't stop page views, which Cloudflare counts at the edge; the privacy page says so
  (`e2e/pages.spec.ts`, "the privacy page covers accounts, news email, Turnstile, guests, error
  reports, page views and deleting").

## About

- Songs, "From public-domain scores in PDMX", the version, and links to Privacy and Support
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").

## Not checked

- Production's build serves no fixture. Only a build shows it, so no journey or unit test checks it:
  `scripts/fixture-library.ts` fails a Production build that carries one, and `scripts/smoke.sh`
  checks each Production deploy.
