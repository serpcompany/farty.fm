# Compose

The Compose tab: the Song Catalog, split by Pitch Coverage into Unlocked and Locked Songs, with
search and sort. A locked Song opens a sheet saying what it needs, and an Unlocked Song opens
[Song Creator](song-creator.md). Why a Song needs farts as long as its notes is
[ADR 0011](../../../../docs/adr/0011-unlocking-needs-farts-as-long-as-notes.md).

## While the Recordings load

- A spinner shows in place of the Songs (`src/components/farty/compose-screen.interaction.test.tsx`,
  "shows a spinner while the Recordings load").

## Without Melodic Recordings

- A card says "No Melodic Recordings yet" and to record a few farts with a clear note, and all 12
  Songs are locked, fewest notes first (`e2e/compose.spec.ts`, "saving farts unlocks Songs on
  Compose, and the Result says so"; `e2e/tabs.spec.ts`, "the app opens on Record, and every tab
  works before the first Recording"; `src/lib/pitch-coverage.test.ts`, "locks every Song, fewest
  notes first, without Melodic Recordings").
- The card hides while a search is typed (`src/components/farty/compose-screen.interaction.test.tsx`,
  "hides the No Melodic Recordings card while a search is typed").

## Locked Songs

- Under "Locked · 12", each row has the Song's title, a Pitch Coverage bar, "1 of 4 notes covered"
  and the notes it needs, at most two by name with the fart length each needs: "Needs D3 (1.2 s)
  and F3 (3.0 s)", or "Needs …, …, and 1 more". A screen reader hears what the row shows, then
  "Locked" (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and the Result
  says so"; `e2e/fixture-library.spec.ts`, "loads the Fixture Library and unlocks every Song it is
  long enough for"; `src/lib/pitch-coverage.test.ts`, "names the missing notes with their octave
  and length").
- A tap opens a sheet with the title, the coverage, the pitch strip with the collected notes filled
  and the needed ones dashed, and every needed note: "Needs a fart near D3 (1.2 s) and F3 (3.0 s)."
  Without Melodic Recordings it says "Record a fart with a clear note to start." Record goes to the
  Record tab, and Close closes it (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose,
  and the Result says so"; `e2e/fixture-library.spec.ts`, "loads the Fixture Library and unlocks
  every Song it is long enough for").
- Hiding the page closes the sheet (`src/components/farty/compose-screen.interaction.test.tsx`,
  "closes a locked Song’s sheet when the page is hidden").
- A locked Song can't be played. Its address says it's locked ([Song Creator](song-creator.md)).

## Unlocked Songs

- Under "Unlocked · 1", each row has the Song's title and "Ready". A tap opens Song Creator and
  starts audio in the tap, so the Toot plays once made (`e2e/compose.spec.ts`, "saving farts unlocks
  Songs on Compose, and the Result says so"; `e2e/song-creator.spec.ts`, "plays each Song with your
  farts, plays a tapped note, and saves it as a Toot").

## What unlocks a Song

- Each distinct pitch needs its own Melodic Recording within 3 semitones of it, or about an octave
  away as an Octave Move, that lasts at least as long as that pitch's longest note. Noise-like and
  unanalyzed Recordings count for nothing (`src/lib/pitch-coverage.test.ts`, "gives each pitch its
  own Recording"; "moves a Recording at most 3 semitones, or an octave with an Octave Move"; "covers
  nothing without Melodic Recordings"; "ignores Noise-like and unanalyzed Recordings"; "unlocks a
  locked Song once a fart near each missing note shows the length it needs").
- The answers match the reference engine's for every Song (`src/lib/pitch-coverage.test.ts`,
  "matches every Song in all 50 subsets of coverage.json"; "reads the coverage of locked Songs as
  the reference does").
- The whole Fixture Library unlocks 8 of the 12 Songs (`e2e/fixture-library.spec.ts`, "loads the
  Fixture Library and unlocks every Song it is long enough for"; `src/lib/pitch-coverage.test.ts`,
  "unlocks 8 of the 12 Songs with the 24 Melodic fixtures").
- Compose follows the Recordings as they're saved, deleted or synced, and matches the Song Catalog
  again only when the Melodic Recordings change (`src/components/farty/recordings-provider.interaction.test.tsx`,
  "matches the Song Catalog again only when Pitch Coverage can change";
  `src/lib/pitch-coverage.test.ts`, "matches the catalog again only when the Melodic Recordings
  change").

## Search and sort

- Search Songs finds a word anywhere in a title, ignoring case and accents. Nothing found says
  "No Results for “zzz”" (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and the
  Result says so"; `src/lib/pitch-coverage.test.ts`, "searches anywhere in the title, ignoring case
  and accents").
- Sort offers Closest to unlocking, the default, which puts the highest coverage first and then the
  fewest notes, and A–Z. Both keep the Unlocked and Locked sections (`e2e/compose.spec.ts`, "saving
  farts unlocks Songs on Compose, and the Result says so"; `src/lib/pitch-coverage.test.ts`, "puts
  the highest coverage first, then fewer notes"; "sorts A–Z within each section").
