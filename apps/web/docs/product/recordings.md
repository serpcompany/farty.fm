# Recordings

The Recordings tab: every Recording kept in this browser and, signed in, on the account, with its
note, Retry for one whose note wasn't found, and placing a noise-like one on a note by ear. Recordings are made on the [Record](record.md)
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
- Each row has the Recording's name ("Recording 1"), its Recording Pitch, "noise-like", or the
  Placed Pitch it was given by ear (see below), a
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

## Placing a noise-like fart by ear

A Noise-like Recording plays in no Song until the person places it on the piano note it sounds
closest to (ADR 0015). It still plays as recorded: the note says only where Songs use it.

- A noise-like row's note is an outlined "noise-like ›" button, which opens the picker: the fart's
  play button, waveform and length, one octave of piano keys with an arrow either side, then Place
  and "Leave it out" (`e2e/record-noise.spec.ts`, "a Noise-like fart can be placed on a note by
  ear, moved, and taken off (ADR 0015)"; `src/components/farty/recordings-screen.interaction.test.tsx`,
  "opens the place-by-ear picker from a noise-like Recording, and closes it when the page is
  hidden").
- It's a bottom sheet on a phone and a dialog from 48rem wide
  (`src/components/farty/place-by-ear.interaction.test.tsx`, "is a bottom Sheet on a phone and a
  Dialog from 48rem").
- It opens on octave 3, C3 to B3, with no key picked and Place disabled as "Tap a key to choose a
  note". The arrows move one octave at a time between C2 and B4, and a key picked stays picked
  (`src/components/farty/place-by-ear.interaction.test.tsx`, "opens on octave 3 with nothing picked,
  and asks for a key"; "moves one octave at a time between C2 and B4, keeping the key picked").
- A tapped key plays a short piano note to hold the fart up to, and becomes "Place at E3". Nothing
  is kept until Place, and "Leave it out" keeps nothing
  (`src/components/farty/place-by-ear.interaction.test.tsx`, "plays a piano note for the key tapped,
  and places the fart there on Place"; "leaves an unplaced fart out without keeping anything").
- Its play button plays the fart, and closing the picker stops it
  (`src/components/farty/place-by-ear.interaction.test.tsx`, "plays the fart from its play button";
  "stops the fart when it closes").
- A placed fart's row shows its note in a dashed pill, with "Placed by ear". It counts as a Melodic
  Recording on that note in the summary, and stays placed after a reload (`e2e/record-noise.spec.ts`,
  "a Noise-like fart can be placed on a note by ear, moved, and taken off (ADR 0015)").
- The pill opens the picker on the placed note, ringed, with "Placed at E3" disabled. Another key
  makes it "Move to", and "Take it off" makes the fart noise-like again (`e2e/record-noise.spec.ts`,
  "a Noise-like fart can be placed on a note by ear, moved, and taken off (ADR 0015)";
  `src/components/farty/place-by-ear.interaction.test.tsx`, "opens a placed fart on its note, ringed
  while another is picked, and moves it or takes it off").
- A placement counts at once, in the summary and on Compose, and one this browser couldn't keep is
  reported (`src/components/farty/recordings-provider.interaction.test.tsx`, "places a Noise-like
  Recording on a note at once, and reports a placement it could not keep").
- A new analysis keeps the placement. If it finds the fart Melodic, its Recording Pitch counts and
  the placement is ignored (`src/lib/recording-store.test.ts`, "keeps the note through a new
  analysis, and places nothing that is gone"; `src/lib/recordings.test.ts`, "counts for nothing
  while the Recording is Melodic, or not analyzed").
- Signed in, the placement reaches the account, and another browser's placement shows here, even
  in an open picker ([Sync](sync.md)).

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

- A guest's Recordings last the visit: they stay through a reload and while Farty is open in
  another tab, and are gone the next time Farty opens, unless they keep them with a free account
  (`e2e/guest-visit.spec.ts`, "a guest's farts last the visit: they record and hear a Song, and
  Farty opens again with none"; `src/lib/visit.test.ts`, "clears a guest's Recordings, their audio
  and their Toots as a new visit opens").
- A guest's Recordings from before keeping them needed an account stay, while those made since go
  after their visit ([Accounts](account.md#guest)).
- Signed in, the Recordings of every browser on the account show and play here, and a delete in one
  browser reaches the others once they come back to Farty. A guest's Recordings join the account
  numbered after the account's own (`e2e/sync.spec.ts`, "two browsers signed in to one account play
  each other's farts, and see each other's deletes"; "a guest's Recording joins the account numbered
  after the account's, in both browsers"). Signing in is in [Accounts](account.md).
- A sync that changes the library updates the list, and stops a deleted Recording that plays
  (`src/components/farty/recordings-provider.interaction.test.tsx`, "takes in what a sync changed,
  and stops a deleted Recording that plays"; "loads everything again after a sync reset").

## A full account

An account keeps at most 300 Recordings. When to try again is in [Sync](sync.md).

- While some Recordings can't upload because the account is full, a line under the title says so:
  "Your account is full, so 2 Recordings are only on this device. Delete some older ones to make
  room." It goes once they've uploaded, which a delete here lets happen at once, without a reload
  (`src/components/farty/recordings-screen.interaction.test.tsx`, "says how many Recordings
  wait for room while the account is full, until they upload"; `e2e/account-full.spec.ts`, "a full
  account keeps a new Recording on this device and says so, without uploading it again, then
  uploads it once a delete makes room").
- A Recording deleted while it waits for room is gone, with nothing sent to the account
  (`src/lib/outbox-send.test.ts`, "forgets a Recording deleted while it waits for room, with no
  request").

## Offline

- The installed app opened offline lists an account's Recordings and plays them
  (`e2e/guest-visit.spec.ts`, "an account's Recording is there when the installed app opens again
  offline";
  `e2e/install.spec.ts`, "the service worker opens the app shell offline").

## Staging

- The Fixture Library, on Staging's Profile, adds its test farts here as the person's own
  Recordings, analyzed like real ones ([Profile](profile.md#internal-build-the-fixture-library)).
