# Recordings

The Recordings tab: every Recording kept in this browser and, signed in, on the account, with its
note, and Retry for one whose note wasn't found. Recordings are made on the [Record](record.md)
tab.

## While the Recordings load

- A spinner shows in place of the list (`src/components/farty/recordings-screen.interaction.test.tsx`,
  "shows a spinner while the Recordings load").

## Empty

- "No Recordings yet", and "Go to the Record tab and tap the red button." (`e2e/tabs.spec.ts`, "the
  app opens on Record, and every tab works before the first Recording").

## The list

- Newest first (`src/components/farty/recordings-screen.interaction.test.tsx`, "lists the newest
  Recording first").
- A summary over the list counts the Melodic Recordings, the notes they cover with their octave,
  and every Recording: "1 Melodic Recording across 1 note", "1 Recording" (`e2e/tabs.spec.ts`, "a
  Recording shows on the Recordings tab with its note, and playback stops on a tab change";
  `e2e/record-noise.spec.ts`, "recording a Noise-like fart says it has no steady note").
- Each row has the Recording's name ("Recording 1"), its Recording Pitch or "noise-like", a
  waveform, the fart's length and, for a take that held more than one fart, "First fart used"
  (`e2e/tabs.spec.ts`, "a Recording shows on the Recordings tab with its note, and playback stops
  on a tab change"; `e2e/record-noise.spec.ts`, "recording a Noise-like fart says it has no steady
  note"; `e2e/record-two-farts.spec.ts`, "recording two farts keeps the first and says so").
- The length is the fart's, not the whole take's (`e2e/fixture-library.spec.ts`, "loads the Fixture
  Library and unlocks every Song it is long enough for"; `src/lib/pitch-coverage.test.ts`, "is the
  fart, not the whole take").
- A tap on a row plays it, and a second tap stops it. The row shows as pressed while it plays
  (`e2e/tabs.spec.ts`, "a Recording shows on the Recordings tab with its note, and playback stops
  on a tab change"; `src/components/farty/playback-provider.interaction.test.tsx`, "shows a sound
  as playing until it ends"; "stops the sound that plays when it is tapped again").
- An analyzed Recording plays only its fart, from where it starts to where it ends; one not
  analyzed plays the whole take (`src/components/farty/playback-provider.interaction.test.tsx`,
  "plays only the fart of an analyzed Recording, and the whole take of one not analyzed";
  `src/lib/audio/player.test.ts`, "a segment plays only that part: from its start, for its
  length").
- Recordings and their notes are still there after a reload (`e2e/record-melodic.spec.ts`,
  "recording a Melodic fart shows its note, and it is still there after a reload").

## Analysis

- A Recording whose analysis is running shows a spinner. One whose note couldn't be found says
  "not analyzed", with Retry, which finds it (`e2e/tabs.spec.ts`, "a Recording that could not be
  analyzed says so, and Retry finds its note").
- A failed analysis is reported and leaves the Recording not analyzed; Retry analyzes only a
  Recording that isn't (`src/components/farty/recordings-provider.interaction.test.tsx`, "reports a
  failed analysis and leaves the Recording not analyzed"; "analyzes again only a Recording that is
  not analyzed").
- An analysis cut off by closing Farty runs again on the next open
  (`src/components/farty/recordings-provider.interaction.test.tsx`, "loads the Recordings, and
  analyzes again one whose analysis was cut off").
- An analysis an older Recording Analysis made runs again on the next open, one Recording at a
  time, and keeps the old answer if the new one fails (`e2e/record-melodic.spec.ts`, "an analysis
  an older Recording Analysis made runs again on the next open"; `src/lib/analysis-upgrade.test.ts`,
  "re-analyzes one Recording at a time"; "leaves the stored analysis as it was when re-analysis
  fails, and goes on").

## Delete

- Each row's Delete asks "Delete Recording 1?", "This can't be undone.", with Cancel and Delete
  Recording. The Recording is gone, after a reload too (`e2e/tabs.spec.ts`, "a Recording shows on
  the Recordings tab with its note, and playback stops on a tab change").
- Hiding the page closes the dialog (`src/components/farty/recordings-screen.interaction.test.tsx`,
  "closes the Delete dialog when the page is hidden").
- Deleting stops whatever plays first (`src/components/farty/recordings-provider.interaction.test.tsx`,
  "stops playback before it deletes a Recording").
- A Toot that used it still plays, and its screen says "Recording deleted" for that pitch
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").

## Guest and signed in

- A guest's Recordings stay in this browser from visit to visit, and still play after Farty is
  closed (`e2e/guest-visit.spec.ts`, "a guest's Recording outlasts closing Farty and still plays,
  while their Toot lasts the visit").
- Signed in, the Recordings of every browser on the account show and play here, and a delete in one
  browser reaches the others once they come back to Farty. A guest's Recordings join the account
  numbered after the account's own (`e2e/sync.spec.ts`, "two browsers signed in to one account play
  each other's farts, and see each other's deletes"; "a guest's Recording joins the account numbered
  after the account's, in both browsers"). Signing in is in [Accounts](account.md).
- A sync that changes the library updates the list, and stops a deleted Recording that plays
  (`src/components/farty/recordings-provider.interaction.test.tsx`, "takes in what a sync changed,
  and stops a deleted Recording that plays"; "loads everything again after a sync reset").

## Offline

- The installed app opened offline lists the Recordings and plays them (`e2e/guest-visit.spec.ts`,
  "a guest's Recording is there when the installed app opens again offline";
  `e2e/install.spec.ts`, "the service worker opens the app shell offline").

## Staging

- The Fixture Library, on Staging's Profile, adds its test farts here as the person's own
  Recordings, analyzed like real ones ([Profile](profile.md#internal-build-the-fixture-library)).
