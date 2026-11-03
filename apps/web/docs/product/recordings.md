# Recordings

The Recordings tab: every Recording kept in this browser and, signed in, on the account, with the
note Songs use, playing and scrubbing, Retry and Re-scan, a Recording's review, sharing and
deleting. Recordings are made on the [Record](record.md) tab; their Trim, note and name are set in
the [Review](review.md).

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
  and every Recording: "1 Melodic Recording across 1 note", "1 Recording". A Recording placed on a
  note in its review counts as Melodic on that note (`e2e/tabs.spec.ts`, "a Recording shows on the
  Recordings tab with its note, and playback stops on a tab change"; `e2e/record-noise.spec.ts`,
  "recording a Noise-like fart says it has no note"; "a Noise-like fart is given a note in its
  review, moved, and left out again (ADR 0015)").
- Each row has the Recording's name ("Recording 1", or the one given in its review), a waveform of
  the whole take, the fart's length, a pencil that opens its [Review](review.md), Share and Delete
  (`e2e/tabs.spec.ts`, "a Recording shows on the Recordings tab with its note, and playback stops on
  a tab change"; `src/components/farty/recordings-screen.interaction.test.tsx`, "names a Recording
  by the name the user gave it, and its pencil opens its review").
- The note pill says the note Songs use, "No note" when they leave it out (Noise-like, or left out in
  its review), or "Finding…" while analysis runs (`src/components/farty/recordings-screen.interaction.test.tsx`,
  "shows the note Songs use, \"No note\" when they leave it out, and \"Finding…\"";
  `e2e/record-noise.spec.ts`, "recording a Noise-like fart says it has no note").
- "Placed by ear" shows under the name of a Recording given a note in its review, and "Trimmed"
  under one with a Trim (`e2e/review.spec.ts`, "a take trimmed, moved to another note and named in
  its review keeps them"; `e2e/record-noise.spec.ts`, "a Noise-like fart can be trimmed in its
  review, and the row then plays just that part (ADR 0019)").
- The length is the fart's, every burst of it, not the whole take's, rounded down to a tenth; once
  trimmed, the length of the fart between the handles. It's what a locked Song's "Needs" is
  measured against (`e2e/fixture-library.spec.ts`, "loads the Fixture Library and unlocks every Song
  it is long enough for"; `src/lib/pitch-coverage.test.ts`, "is the fart, not the whole take"; "is
  its Trim’s fart once trimmed, Melodic or not (#314)"; `e2e/record-two-farts.spec.ts`, "recording
  two farts keeps both, and replay plays the whole take").
- A Placed Pitch stays on the row after a later analysis finds a Recording Pitch, since the person
  chose it (`src/components/farty/recordings-screen.interaction.test.tsx`, "keeps showing the
  Placed Pitch when a later analysis found a Recording Pitch").
- Recordings and their notes are still there after a reload (`e2e/record-melodic.spec.ts`,
  "recording a Melodic fart shows its note, and it is still there after a reload").

## Playing

- A tap on a row plays it, and a second tap stops it. The row shows as pressed while it plays, and
  a tab change or hiding the page stops it (`e2e/tabs.spec.ts`, "a Recording shows on the Recordings
  tab with its note, and playback stops on a tab change";
  `src/components/farty/playback-provider.interaction.test.tsx`, "shows a sound as playing until it
  ends"; "stops the sound that plays when it is tapped again").
- A row plays the whole take, start to end, from its saved file, both farts of a take with two
  (ADR 0016). A trimmed Recording plays exactly what's between its handles
  (`src/components/farty/playback-provider.interaction.test.tsx`, "replays a Recording as the whole
  take, start to end, from its saved file"; "plays a trimmed Recording's handles, and the part a
  scrub asks for"; `e2e/record-two-farts.spec.ts`, "recording two farts keeps both, and replay plays
  the whole take"; `e2e/record-noise.spec.ts`, "a Noise-like fart can be trimmed in its review, and
  the row then plays just that part (ADR 0019)").
- The waveform draws the whole take, both bursts and the silence around them, or just the Trim,
  scaled to its own loudest (`src/components/farty/recording-replay.interaction.test.tsx`, "draws
  the whole take, both bursts and the silence around them, whatever analysis found"; "draws just the
  part asked for, as a Trim, scaled to its own loudest").
- While it plays, a playhead moves with the audio, filling the bars it has passed. It follows the
  audio clock, held back by the output's latency where the browser reports it, as on Bluetooth
  (`src/components/farty/waveform.interaction.test.tsx`, "is a slider named for its Recording, with
  no playhead until it plays"; "moves its playhead with the audio clock, filling the bars it has
  passed"; `src/lib/audio/player.test.ts`, "says where the sound playing is by the audio clock, from
  where it started to its end"; "holds the playhead back by the latency the output reports, as on
  Bluetooth"). With reduced motion asked for, the playhead hides while it plays and the bars still
  fill; a scrub's playhead still shows (`e2e/record-noise.spec.ts`, "a Noise-like fart can be
  trimmed in its review, and the row then plays just that part (ADR 0019)").
- The waveform is a slider ("Play Recording 1 from a spot"): a tap plays from that spot, a drag
  scrubs and plays from where it lets go, and the arrow keys jump a twelfth of the view. On a phone a
  finger scrubs across the row, and a scroll up or down stops the scrub without playing
  (`src/components/farty/waveform.interaction.test.tsx`, "plays from the spot a tap lands on";
  "scrubs while dragged, then plays from where it lets go"; "jumps a twelfth of the view with the
  arrow keys"; "stops scrubbing without playing when the browser takes the touch for a scroll";
  `e2e/record-noise.spec.ts`, "a Noise-like fart can be trimmed in its review, and the row then
  plays just that part (ADR 0019)").

## Analysis and Re-scan

- A Recording whose analysis is running says "Finding…". One whose note couldn't be found says
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
- A Recording with no note whose analysis an older Recording Analysis made has Re-scan, and the tab
  has Re-scan all. A fart left out with "No note", or one the current analysis found no note in, has
  none (ADR 0017; `src/components/farty/recordings-screen.interaction.test.tsx`, "offers Re-scan on
  each Recording an older analysis found no note in, and Re-scan all"; "has no Re-scan once the
  current analysis made every Recording’s"; `src/lib/analysis-upgrade.test.ts`, "offers Re-scan only
  while an older analysis says there is no note"; "offers no Re-scan on a fart left out with \"No
  note\" (#314)"; `e2e/record-noise.spec.ts`, "a fart the current analysis found no note in offers no
  Re-scan (#282)").
- Re-scan runs the current Recording Analysis again, one Recording at a time, and says what changed:
  "1 fart now has a note", or "No new notes", and how many couldn't be read. Re-scan all shows how
  far it is ("Re-scanning 2 of 3") and the Recording it's on, with Re-scan off meanwhile
  (`e2e/record-melodic.spec.ts`, "Re-scan finds the note of a fart the open’s upgrade couldn’t read
  (#282)"; `src/components/farty/recordings-screen.interaction.test.tsx`, "runs Re-scan all, then
  says what changed"; "re-scans one Recording, then says when it found nothing new"; "shows how far
  Re-scan all is and the Recording it is on, with Re-scan off meanwhile";
  `src/lib/analysis-upgrade.test.ts`, "re-scans all with no note, one at a time, and leaves the rest
  alone"; "counts one it can’t re-scan, keeps its analysis, and goes on").
- A Recording deleted or placed by ear before Re-scan reaches it is skipped, and a Placed Pitch or
  Trim saved while it runs stays: Re-scan changes only the analysis (`src/lib/analysis-upgrade.test.ts`,
  "skips one deleted before the run reaches it, and counts it nowhere"; "skips one placed by ear
  while its own analysis runs, and keeps the Placed Pitch"; "keeps a Trim through a Re-scan, and
  still uses it once the fart is Melodic (#314)";
  `src/components/farty/recordings-provider.interaction.test.tsx`, "keeps a Trim saved while a
  Re-scan ran: the Re-scan changes only the analysis"; "runs one Re-scan at a time, on the
  Recordings it is asked for").
- A result that came while the tab was closed is kept, and announced when the tab opens again
  (`src/components/farty/recordings-screen.interaction.test.tsx`, "announces a result that came
  while the tab was closed, when it opens again (#295)";
  `src/components/farty/recordings-provider.interaction.test.tsx`, "keeps the last Re-scan’s result
  with no Recordings tab open, until the next one starts").

## A Recording's note in Songs

A Recording's note says only where Songs use it; it still plays as recorded (ADR 0012, ADR 0015).

- A note given in the review counts at once, in the summary and on Compose, and one this browser
  couldn't keep is reported (`src/components/farty/recordings-provider.interaction.test.tsx`,
  "places a Noise-like Recording on a note at once, and reports a placement it could not keep").
- A new analysis keeps the Placed Pitch, which stays the one used even if it finds a Recording
  Pitch, and keeps the Trim in use with it (ADR 0017; `src/lib/recording-store.test.ts`, "keeps the
  note through a new analysis, and places nothing that is gone"; `src/lib/recordings.test.ts`,
  "stays in use when a new analysis finds a Recording Pitch (ADR 0017)"; "keeps its Trim in use with
  it, and a Trim alone on a Melodic Recording too (#314)"; "counts for nothing while the Recording is
  not analyzed").
- A Trim is kept beside the take through a new analysis and a new note, until it's taken off
  (`src/lib/recording-store.test.ts`, "keeps a Trim beside the take, through a new analysis and a new
  note, until it is taken off (ADR 0019)"; `src/components/farty/recordings-provider.interaction.test.tsx`,
  "trims a Recording to its handles, with the fart found between them, and takes the Trim off").

## Share

- Each row's Share shares the Recording by link, and a shared row shows Shared. Sharing, Stop
  sharing and a guest's free account are in [Sharing](sharing.md) (`e2e/share-recording.spec.ts`,
  "a signed-in user shares a Recording, someone signed out plays it, and Stop sharing takes the link
  down").

## Delete

- Each row's Delete asks "Delete Recording 1?", "This can't be undone.", with Cancel and Delete
  Recording. The Recording is gone, after a reload too (`e2e/tabs.spec.ts`, "a Recording shows on
  the Recordings tab with its note, and playback stops on a tab change").
- Deleting a shared Recording takes its link down too ([Sharing](sharing.md);
  `e2e/share-recording.spec.ts`, "a signed-in user shares a Recording, someone signed out plays it,
  and Stop sharing takes the link down").
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

## Not checked

- Deleting a shared Recording says "Its link stops working too." in its Delete dialog.
- A row keeps only its waveform's bars, never its decoded take, so a library of a few hundred
  Recordings fits in a phone's memory.
