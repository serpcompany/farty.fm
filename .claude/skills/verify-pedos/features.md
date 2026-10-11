# Pedos iPhone app: feature map

The top three user-facing features, each with the UI test that drives it. Run one with
[`SKILL.md`](SKILL.md): put the feature's id in `RUN` and its test in `TEST`. Names follow
`CONTEXT.md`. Add a feature here when later work touches one that isn't listed.

## record: Record a fart and see its Recording Pitch

- **What:** the core loop. The user records a fart, saves it, and the Result screen shows the
  note it sounds (its Recording Pitch); it's kept on the Recordings tab across relaunch.
- **How a user reaches it:** the app opens on the Record tab. Tap the record button, then Stop;
  Review ("New Recording") opens; tap Save; the Result shows "Your note"; Done opens Recordings.
- **Drive:** `PedosUITests/ShippedBuildSmokeTests/testRecordSaveHearThePitchReplayRelaunchAndDelete`
  (real recorder, store and Recording Analysis on Debug with `-PedosLive YES`; the take is
  Fixture Library 090 via `-PedosTestTake`). Selectors: `record-button`, `stop-button`,
  navigation bar `New Recording`, button `Save`, text `result-note`, button `Done`, rows
  `Recording <n>`. On sample data instead:
  `PedosUITests/RecordFlowUITests/testRecordReviewSaveResultRecordingsAndDelete`.
- **Proves it:** the `Result` screenshot shows `G3` under "Your note"; `Recordings, playing`
  shows the row with G3, playing; the test then checks it survives a relaunch and deletes it.

## toot: Make a Toot from an Unlocked Song and save it

- **What:** Song Creator plays a Song from the Song Catalog with the user's own Recordings
  (Auto-map), and Save to Toots keeps it.
- **How a user reaches it:** Compose tab, tap an Unlocked Song ("Ode to Joy"); Song Creator makes
  the Toot and plays it once; tap "Save to Toots"; it's on the Toots tab.
- **Drive:** `PedosUITests/ComposeUITests/testUnlockedSongPlaysAndSavesToToots` (sample data,
  `-PedosSampleStart all`, rendered by the real `TootRenderer`). Selectors: tab `Compose`,
  button `Ode to Joy`, `song-creator-play`, `Save to Toots` / `Saved to Toots`, tab `Toots`,
  `play Ode to Joy`. With real recordings end to end:
  `PedosUITests/ShippedBuildSmokeTests/testRecordFourFartsThenMakeATootThatLasts` (about 2
  minutes).
- **Proves it:** `Song Creator, playing` shows the 30 notes and the five Recordings Auto-map
  chose; `Toots, playing` shows "Ode to Joy · Today · 0:18", playing.

## toots: Replay, rename and delete Toots

- **What:** the Toots tab lists saved Toots newest first, plays them, and renames or deletes one
  with a confirmation.
- **How a user reaches it:** Toots tab; long-press a Toot for Rename or Delete, or swipe left to
  Delete.
- **Drive:** `PedosUITests/TootsUITests/testRenameAndDelete` (sample data with two Toots,
  `-PedosSampleToots twinkle,mary`). Selectors: tab `Toots`, rows by Toot title, context menu
  `Rename` / `Delete`, alert `Rename` with `Save`, confirmation `Delete Toot`.
- **Proves it:** `Rename` shows "Mary Had a Little Lamb Remix" typed in the alert;
  `Toots, delete confirmation` shows "Delete Mary Had a Little Lamb Remix?"; the test ends on
  "Nothing yet".
