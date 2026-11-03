# Song Creator

`/compose/<song>/`: an Unlocked Song played with the person's own Recordings, as a Toot they can
play, take apart note by note, and save. Every Song in the Song Catalog has its own page, inside
the Compose tab. Auto-map chooses the Arrangement and each Recording plays raw, at its own pitch
and speed ([ADR 0005](../../../../docs/adr/0005-song-creator-is-automatic.md),
[ADR 0012](../../../../docs/adr/0012-songs-play-farts-raw.md)). A saved Toot is on the
[Toots](toots.md) tab; paying to save one is in [Paying to save a Toot](payments.md).

## Opening it

- The header has Back to Compose, the Song's title and its source, and the Song's heart
  ([Favorite Songs](compose.md#favorite-songs)). Each Song's page comes with its title and source,
  so a link or a search engine opens it on its own (`e2e/song-creator.spec.ts`, "plays each Song
  with your farts, plays a tapped note, and saves it as a Toot"; `e2e/favorites.spec.ts`,
  "favorites Songs, filters and sorts by them, and keeps them over a reload").
- The Song's notes load as it opens: the Song Catalog's index has only what Compose needs. Then
  "Making your Toot…" shows while the Toot renders (`src/components/farty/song-notes.interaction.test.tsx`,
  "makes the Toot from the Song's notes, once they've loaded"; `src/lib/catalog/load-songs.test.ts`,
  "fetches a Song's notes once, as it opens, for every caller").
- Opened by a tap, on Compose or the Result's Try it, the Toot plays by itself once made
  (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped note, and saves it
  as a Toot"; `e2e/record-warm.spec.ts`, "the microphone stays open from Result to every screen
  after it").
- Opened from a link or a reload, before any tap, it waits on Ready until Play is tapped. Back to
  Compose goes back in history when Compose opened it, and otherwise replaces the page, so the
  system Back doesn't return to it (`e2e/song-creator.spec.ts`, "plays each Song with your farts,
  plays a tapped note, and saves it as a Toot", its step "a direct load waits on Ready until a
  tap").

## Locked, unknown and failed

- A locked Song's address says "This Song is locked. Record the notes it needs to unlock it.", with
  no player (`e2e/song-creator.spec.ts`, "a locked Song says how to unlock it, and an unknown Song
  is not found, on no tab"; `src/lib/toot-renderer.test.ts`, "is locked without the Recordings to
  unlock the Song").
- An address that names no Song answers 404, "Page not found", with no tab current
  (`e2e/song-creator.spec.ts`, "a locked Song says how to unlock it, and an unknown Song is not
  found, on no tab"). No Song may take the ids of Compose's own pages, `pad` and `song`
  (`src/lib/catalog/catalog.test.ts`, "refuses a Song whose id is Compose's own page %s";
  `src/lib/pads.test.ts`, "is no Song’s: `/compose/pad/` comes before the Songs’
  `/compose/[song]/`").
- Notes that don't load, offline for a Song never opened among them, say "Couldn't load this
  Song.", with Try again, and are reported; the title still shows (`e2e/compose.spec.ts`, "says so
  in Song Creator when a Song's notes don't load, and Try again loads them";
  `src/components/farty/song-notes.interaction.test.tsx`, "says it couldn't load the Song, and
  tries again on Try again"; `src/lib/catalog/load-songs.test.ts`, "tries again after a failed
  fetch, and refuses notes that are not a melody").
- A render that fails, or a Recording whose audio is gone, says "Couldn't make this Toot.", with Try
  again, and is reported (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a
  tapped note, and saves it as a Toot", its step "a failed render says it couldn't, and Try again
  makes it"; `src/lib/toot-renderer.test.ts`, "can't be made when a Recording's audio is gone";
  "can't be made when the render fails").

## The player

- Play and Stop, a state of Ready, Playing or Couldn't play, and how many Recordings play it, one
  per note (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped note, and
  saves it as a Toot").
- The note view draws each note as a bar in its pitch's color, with a playhead while the whole Toot
  plays; with reduced motion asked for, the playhead hides and the playing note still lights up. A
  tap anywhere on it plays the nearest note alone, from the Toot's own audio at its written
  start and length, selects it, and says what it is: the note, the Recording and its Recording
  Pitch, and the written length, as "F3 · Recording 21 (G3) · 1.4 s" (`e2e/song-creator.spec.ts`,
  "plays each Song with your farts, plays a tapped note, and saves it as a Toot";
  `src/lib/toot.test.ts`, "names the note, its Recording and Recording Pitch, and the written
  length"; "times a note by its written start and length"; `src/components/farty/toots-provider.interaction.test.tsx`,
  "plays one note of a made Toot as written, from a copy of its audio").
- A Noise-like Recording placed by ear shows its Placed Pitch there, as it is now
  (`src/lib/toot.test.ts`, "names the note a Noise-like Recording is placed on by ear (ADR 0015)").
- Each note is also a button, out of the pointer's way, named for the keyboard and screen readers
  with its note, start time and Recording, and whether it is selected, highlighted or playing
  (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped note, and saves it
  as a Toot").
- Recordings used lists one row per distinct pitch: its color, the Recording's name, waveform and
  fart length, and the note it plays. A tap plays that Recording alone and highlights its notes
  (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped note, and saves it
  as a Toot").
- Every control is at least 44 by 44 CSS pixels (`e2e/song-creator.spec.ts`, "plays each Song with
  your farts, plays a tapped note, and saves it as a Toot").
- Leaving Song Creator stops what plays (`src/components/farty/song-creator.interaction.test.tsx`,
  "stops what plays when it is left").

## Saving

- Save to Toots, pinned above the tabs, is the [Sound Pad](sound-pad.md#saving-a-take)'s too. It
  saves the Toot to an account. It says "Save to Toots · $0.99" and goes through
  checkout first, on Production, Staging and a local run ([Paying to save a Toot](payments.md)). A
  guest's Save opens the account step first, and carries on once they sign in
  ([Accounts](account.md#when-the-step-opens)) (`e2e/song-creator.spec.ts`, "plays each Song with
  your farts, plays a tapped note, and saves it as a Toot"; `e2e/production-save.spec.ts`, "a
  signed-in save pays $0.99 first, and two taps pay for and save one Toot";
  `e2e/account-pay.spec.ts`, "a guest's Toot plays free, and Save asks for an account first";
  `src/components/farty/song-creator.interaction.test.tsx`, "asks for an account before saving or
  paying, where saving is %s").
- Where saving is made free again in `src/lib/pricing.ts`, Save says "Save to Toots" and saves at
  once, with no checkout (`src/components/farty/song-creator.interaction.test.tsx`, "saves at once
  where saving is free, with no checkout"; `src/app/api/payments-environments.workers.test.ts`,
  "answers paid to checkout and payment, with no checkout and no Stripe").
- Saved, the button turns into a disabled "Saved to Toots". Two quick taps save it once
  (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped note, and saves it
  as a Toot"; `src/components/farty/toots-provider.interaction.test.tsx`, "saves a made Toot once").
- A Toot is saved with its audio and which Recording played each pitch, titled with the Song's
  title (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped note, and
  saves it as a Toot").
- A save that fails says "Couldn't save this Toot." and is reported, and Save can be tapped again
  (`src/components/farty/song-creator.interaction.test.tsx`, "says a save that failed couldn't save,
  and reports it").
- While the Toot is unsaved, a reload after a deploy waits for it ([App
  shell](app-shell.md#a-new-deploy); `src/components/farty/song-creator.interaction.test.tsx`,
  "holds off a new build until the Toot is saved").
- A saved Toot is kept on the account ([Toots](toots.md)).

## Offline

- The installed app opens a Ready Song offline, makes its Toot and plays it
  (`e2e/song-creator.spec.ts`, "the installed app opens a Ready Song offline, and makes its Toot").
- Offline, every Song's page opens on the one Song page the service worker keeps,
  `/compose/song/`, which reads the Song from the address and gives the tab the Song's title once
  the Song Catalog loads. It is always the current build's, never a Song's own page from an older
  one (`e2e/song-creator.spec.ts`, "the installed app opens a Ready Song offline, and makes its
  Toot"; `src/lib/service-worker.test.ts`, "never keeps a Song's own page, so offline every Song
  opens on the one Song page"; "opens a Song offline on the current build's Song page after a
  deploy, never an older build's").
- The notes of every Song are fetched in the background once Farty is installed, so a Song never
  opened plays offline too ([Installing and offline](install.md#offline)).

## Not checked

- "Couldn't find this Song." when the loaded Song Catalog has no Song of the address's id, which
  only the offline Song page can reach, and "Couldn't load the Songs.", with Try again, when the
  Song Catalog didn't load: no test opens Song Creator either way.
