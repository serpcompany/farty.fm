# Compose

The Compose tab: the Sound Pad's row, then every Song in the Song Catalog, split by Pitch Coverage
into Unlocked and Locked Songs, with search, sort and Favorite Songs. The catalog is every Song in
`catalog/`, over 1,000, but `ode-mutopia`, the same tune as Ode to Joy: the iPhone app's 12 first,
in its order, then the rest in the catalog's (#350) (`src/lib/catalog/catalog.test.ts`, "holds the
iPhone app's 12 Songs first, in its order"; "then every other Song in the catalog, in its order,
but ode-mutopia"; "ships every Song in the catalog but ode-mutopia, the same tune as ode"). A locked Song opens a sheet
saying what it needs, an Unlocked Song opens [Song Creator](song-creator.md), and the Sound Pad's
row opens the [Sound Pad](sound-pad.md). Why a Song needs farts as long as its notes is
[ADR 0011](../../../../docs/adr/0011-unlocking-needs-farts-as-long-as-notes.md).

## While the Songs load

- A spinner shows in place of the Songs while the Recordings, the Song Catalog or the Favorite
  Songs load (`src/components/farty/compose-screen.interaction.test.tsx`, "shows a spinner while
  the Recordings load").
- The Song Catalog is fetched once for the whole app, as data, named in each page's head so it
  downloads beside the page's scripts (`src/components/farty/song-catalog-provider.interaction.test.tsx`,
  "names the Song Catalog in the page head, loads it once for the app, and finds a Song by its id";
  `src/lib/catalog/load-songs.test.ts`, "fetches this build's catalog once, for every caller").
  Compose reads only its index: each Song's titles, pitches and note lengths, never its notes
  (`src/lib/catalog/catalog.test.ts`, "is an index the browser fetches by its content and the
  server imports"; "has each Song’s notes in a file of their own, named by its content").

## When the Songs don't load

- Compose says "Couldn't load the Songs.", with Try again, which loads them; Profile says the same
  ([Profile](profile.md#stats)) (`e2e/compose.spec.ts`, "says so on Compose and Profile, and Try
  again loads it"; `src/components/farty/compose-screen.interaction.test.tsx`, "says the Songs
  didn’t load, and loads them again on Try again"; `src/components/farty/song-catalog-provider.interaction.test.tsx`,
  "loads it again with Try again").
- A Song Catalog that didn't load is reported, and loads again by itself once the browser is back
  online. An answer that is an error, or not a list of Songs, counts as not loaded
  (`src/components/farty/song-catalog-provider.interaction.test.tsx`, "reports a Song Catalog that
  didn't load, and loads it once the browser is back online"; `src/lib/catalog/load-songs.test.ts`,
  "tries again after a failed fetch"; "refuses an answer that is an error, or not a list of
  Songs").

## The Sound Pad's row

- Above the Songs, "Sound Pad", "Tap your farts to play them", opens `/compose/pad/`
  (`e2e/sound-pad.spec.ts`, "the Sound Pad fills with your farts, plays one at a tap, and keeps the
  Pad you change"). It shows with the whole catalog, not while the Favorites filter is on
  (`e2e/favorites.spec.ts`, "favorites Songs, filters and sorts by them, and keeps them over a
  reload").

## Without Melodic Recordings

- A card says "No Melodic Recordings yet" and to record a few farts with a clear note, and every
  Song is locked, fewest notes first (`e2e/compose.spec.ts`, "saving farts unlocks Songs on
  Compose, and the Result says so"; `e2e/tabs.spec.ts`, "the app opens on Record, and every tab
  works before the first Recording"; `src/lib/song-listing.test.ts`, "locks every Song, fewest
  notes first, without Melodic Recordings").
- The card hides while a search is typed (`src/components/farty/compose-screen.interaction.test.tsx`,
  "hides the No Melodic Recordings card while a search is typed").

## Locked Songs

- Under "Locked" and their count, each row has the Song's title, a Pitch Coverage bar, "1 of 4
  notes covered", the notes it needs, at most two by name with the fart length each needs: "Needs
  D3 (1.2 s) and F3 (3.0 s)", or "Needs …, …, and 1 more", and its heart. A screen reader hears
  what the row shows, then "Locked" (`e2e/compose.spec.ts`, "saving farts unlocks Songs on
  Compose, and the Result says so"; `e2e/fixture-library.spec.ts`, "loads the Fixture Library and
  unlocks every Song it is long enough for"; `src/lib/song-listing.test.ts`, "names the missing
  notes with their octave and length").
- A row works out what it needs only once it is near the screen, and again when the Recordings
  change, so Compose stays quick with every Song; its Needs line keeps its place until then. The
  counts, and so the sections, cover every Song at once (`src/components/farty/use-near-viewport.interaction.test.tsx`,
  "turns false when the row moves away, and true when it comes back"; "works out only the rows near
  the screen when the Recordings change after a full scroll"; `src/lib/song-listing.test.ts`,
  "counts every Song as its Arrangement does, after each take of the story (#323)"; "scales to
  hundreds of Songs"; `src/lib/engine/auto-map.test.ts`, "counts what Auto-map covers, on each
  library and on random ones with placed farts").
- A tap opens a sheet with the title, its heart, the coverage, the pitch strip with the collected
  notes filled and the needed ones dashed, and every needed note: "Needs a fart near D3 (1.2 s)
  and F3 (3.0 s)." Without Melodic Recordings it says "Record a fart with a clear note to start."
  Record goes to the Record tab, and Close closes it (`e2e/compose.spec.ts`, "saving farts unlocks
  Songs on Compose, and the Result says so"; `e2e/fixture-library.spec.ts`, "loads the Fixture
  Library and unlocks every Song it is long enough for").
- Hiding the page closes the sheet (`src/components/farty/compose-screen.interaction.test.tsx`,
  "closes a locked Song’s sheet when the page is hidden").
- A locked Song can't be played. Its address says it's locked ([Song Creator](song-creator.md)).

## Unlocked Songs

- Under "Unlocked" and their count, each row has the Song's title, "Ready" and its heart. A tap
  opens Song Creator and starts audio in the tap, so the Toot plays once made (`e2e/compose.spec.ts`,
  "saving farts unlocks Songs on Compose, and the Result says so"; `e2e/song-creator.spec.ts`,
  "plays each Song with your farts, plays a tapped note, and saves it as a Toot").

## Favorite Songs

A heart marks a Favorite Song (#313): on each Song's row, in a locked Song's sheet and in Song
Creator, named "Favorite" and the Song's title, pressed while it is one.

- A tap on any of them marks the Song or takes it off, and every other heart for that Song follows
  (`e2e/favorites.spec.ts`, "favorites Songs, filters and sorts by them, and keeps them over a
  reload"; `src/lib/favorites-sync.test.ts`, "keeps each tap here and queues it, a tap undoing an
  unsent one leaving nothing"; "tells this tab when they change, and nothing when a tap changes
  nothing").
- The Favorites button shows only Favorite Songs, in both sections and the same order, and a
  search looks within them. With none it says "No Favorites yet" and "Tap the heart on a Song to
  add it to your Favorites." (`e2e/favorites.spec.ts`, "favorites Songs, filters and sorts by
  them, and keeps them over a reload"; `src/lib/song-listing.test.ts`, "filters to Favorite Songs,
  keeping both sections and the order"; "searches within the filter"; "shows nothing with no
  Favorite Songs, and ignores ids not in the catalog").
- Sort's Favorites first puts them first in each section, each part closest to unlocking; with
  none it is Closest to unlocking (`e2e/favorites.spec.ts`, "favorites Songs, filters and sorts by
  them, and keeps them over a reload"; `src/lib/song-listing.test.ts`, "puts Favorite Songs first,
  each part closest to unlocking"; "sorts closest to unlocking when there are no Favorite Songs").
- The filter and the sort are this browser's: they're as they were left after a reload
  (`e2e/favorites.spec.ts`, "favorites Songs, filters and sorts by them, and keeps them over a
  reload").
- A guest's Favorite Songs outlast their visit, unlike their farts, and go to the account they
  sign in with (`src/lib/favorites-sync.test.ts`, "keeps them over the next visit, and sends them
  to the account once it is theirs"; `src/app/api/signed-in.workers.test.ts`, "keeps a guest’s
  Favorite Songs on the account they sign up with").
- Signed in, they're kept with the account. Another browser's show here, and one taken off there
  goes here too; a tap still on its way wins over what the account read
  (`e2e/favorites.spec.ts`, "favorites Songs, filters and sorts by them, and keeps them over a
  reload"; `src/lib/favorites-sync.test.ts`, "sends each to the account, naming the library's
  account, and isn't counted as a fart"; "brings another browser's, and takes off what it took off,
  telling the screens"; "keeps a tap this browser is still sending over what the account read";
  `src/app/api/favorites.workers.test.ts`, "leaves a tombstone that later reads list, and a
  favorite again clears it").
- A tap made offline waits and goes once the account can be reached. An account keeps at most
  5,000; one past that stays marked here until the next full read
  (`src/lib/favorites-sync.test.ts`, "keeps a tap queued while the account is unreachable, and
  drops one refused at the limit"; `src/app/api/favorites.workers.test.ts`, "stops at the limit
  (409), and still answers a Song already marked").
- They go with the library at Sign out, and with the account when it's deleted
  (`src/lib/favorites-sync.test.ts`, "go with the library at sign-out, and with another account’s
  claim"; `src/app/api/favorites.workers.test.ts`, "go with the account when it is deleted").

## What unlocks a Song

- Each distinct pitch needs its own Melodic Recording within 3 semitones of it, or about an octave
  away as an Octave Move, that lasts at least as long as that pitch's longest note. Unanalyzed
  Recordings, and Noise-like ones not placed by ear, count for nothing (`src/lib/pitch-coverage.test.ts`,
  "gives each pitch its own Recording"; "moves a Recording at most 3 semitones, or an octave with an
  Octave Move"; "covers nothing without Melodic Recordings"; "ignores Noise-like and unanalyzed
  Recordings"; "unlocks a locked Song once a fart near each missing note shows the length it
  needs").
- A Recording given a note by ear in its [review](review.md) counts as a Melodic Recording on that
  note, at its own length, and only on a whole note from C2 to B4, even after a later analysis
  finds it Melodic. Placing Noise-like Recording 065 on C2 unlocks 5 of the iPhone app's Songs the
  small library leaves locked. "No note" leaves a Recording out: leaving out 002 locks Amazing
  Grace (`src/lib/pitch-coverage.test.ts`, "covers its note like a Melodic Recording: 065 on C2
  unlocks 5 Songs the small library leaves locked"; "counts for nothing left out, the default";
  "stays in use when a new analysis finds the Recording Melodic (ADR 0017)"; "counts only a whole
  note from C2 to B4, as the review offers"; "collects the pitch class it is placed on"; "shows no
  unlock for a Noise-like save until it is placed"; "leaves a Melodic Recording out with \"No
  note\": 002 out locks Amazing Grace (#314)").
- Auto-map counts a placed fart as holding its note only from 0.6 s, so an analyzed fart at the
  same distance gets the shorter notes; it still covers a pitch nothing else can
  (`src/lib/engine/auto-map-rules.test.ts`, "counts as Melodic at its note, at its own length,
  holding it from 0.6 s"; "covers a note nothing else does, as tools/melody-lab/test_placed.py: 065
  on C2 unlocks 2 Songs the small library leaves locked"). Songs play it raw, cut at its fart and
  lead-in like any other (`src/lib/engine/renderer.test.ts`, "cuts the golden gesture and its
  lead-in, a Noise-like one too, for a fart placed by ear (ADR 0015)").
- A trimmed Recording counts at its Trim's length (`src/lib/engine/auto-map-rules.test.ts`, "counts
  a trimmed Melodic Recording at its note and its Trim’s length (#314)";
  `src/lib/pitch-coverage.test.ts`, "is its Trim’s fart once trimmed, Melodic or not (#314)").
- The answers match the reference engine's for every Song it arranges, the 128 the app listed
  before #350; every later Song passed the catalog import's render gate on the reference engine
  (`src/lib/pitch-coverage.test.ts`,
  "matches every Song in all 50 subsets of coverage.json"; "reads the coverage of locked Songs as
  the reference does"; `src/lib/engine/auto-map.test.ts`, "unlocks all but 5 Songs on the full
  library, and the 13 from before #229, 2 of those on the small one").
- The whole Fixture Library unlocks every Song the reference says it does, all 12 of the iPhone
  app's among them, and the app's own analysis of the fixtures unlocks the same Songs as the
  reference's analysis across the whole catalog; without 002, its longest fart, 40 more lock,
  Amazing Grace among them (`e2e/fixture-library.spec.ts`, "loads the Fixture Library and unlocks
  every Song it is long enough for"; `src/lib/fixture-library.test.ts`, "analyzes as the reference
  does and unlocks the Songs it does, as 16-bit WAV"; `src/lib/song-listing.test.ts`, "unlocks the Songs the reference does with the whole
  Fixture Library"; "unlocks all 12 of the iPhone’s Songs with the whole Fixture Library, and 11
  without 002"; "locks 40 more of the catalog’s Songs without 002, Amazing Grace among them";
  `src/lib/pitch-coverage.test.ts`, "unlocks the Songs the reference does with the 26 Melodic
  fixtures, the iPhone’s 12 too").
- Compose follows the Recordings as they're saved, deleted, placed by ear or synced, and matches
  the Song Catalog again only when the Melodic Recordings or a placement change (`src/components/farty/recordings-provider.interaction.test.tsx`,
  "matches the Song Catalog again only when Pitch Coverage can change";
  `src/lib/song-listing.test.ts`, "matches the catalog again only when the Melodic Recordings
  change"; `src/lib/pitch-coverage.test.ts`, "matches the catalog again when the fart is placed,
  moved or taken off").

## Search and sort

- Search Songs finds a word anywhere in a Song's title or its other names ("Londonderry" finds
  Danny Boy), ignoring case, accents and punctuation. Nothing found says "No Results for “zzz”"
  (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and the Result says so";
  `src/lib/song-listing.test.ts`, "searches anywhere in the title, ignoring case and accents";
  "finds a Song by another of its names, ignoring punctuation (#323)";
  `src/lib/catalog/catalog.test.ts`, "finds a Song by the other titles in tools/catalog/, once
  each").
- Sort offers Closest to unlocking, the default, which puts the highest coverage first and then the
  fewest notes, A–Z, and Favorites first (above). Each keeps the Unlocked and Locked sections
  (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and the Result says so";
  `src/lib/song-listing.test.ts`, "puts the highest coverage first, then fewer notes"; "sorts A–Z
  within each section").

## Not checked

- Search reads "&" as "and", and ignores apostrophes, as the catalog import matched the names to
  their scores (`src/lib/catalog/search-key.ts`): no test types either.
- Where the browser's storage is blocked, the sort and the Favorites filter last only the page.
