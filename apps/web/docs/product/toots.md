# Toots

The Toots tab and a Toot's own screen: the Toots saved in [Song Creator](song-creator.md), to play,
open, rename and delete. A guest's Toots last the visit; an account keeps them
([Accounts](account.md)).

## Empty

- "Nothing yet", and "Make one in Compose." (`e2e/tabs.spec.ts`, "the app opens on Record, and every
  tab works before the first Recording"; `e2e/toots-kept.spec.ts`, "Toots are kept: made, found
  after a relaunch, renamed, and deleted").

## The list

- Newest first. Each row has a play button, the Toot's title, and its Song, day and length:
  "Mary Had a Little Lamb · Today · 0:12". The day is Today, Yesterday or a date
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted";
  `src/lib/toot.test.ts`, "says Today and Yesterday by the calendar day, and a date before that";
  "gives the length in minutes and seconds, rounded to the second"; "shows the Song, the date and
  the length, or that the audio is missing").
- The play button plays the Toot and turns into Stop (`e2e/toots-kept.spec.ts`, "Toots are kept:
  made, found after a relaunch, renamed, and deleted"; `e2e/sync.spec.ts`, "two browsers signed in
  to one account play each other's farts, and see each other's deletes").
- A Toot whose audio couldn't be read this time says "Couldn't play" in place of its day and length,
  until it plays again (`e2e/toots.spec.ts`, "a Toot whose audio is gone says so, and can't play;
  one the store fails for a moment is kept"; `src/components/farty/toots-provider.interaction.test.tsx`,
  "says a saved Toot couldn't play until it plays again or its screen closes").
- A Toot whose audio is gone says "Audio missing", with a warning in place of play. A tap explains
  that it can't be played and can be deleted and made again in Compose, with Cancel and Delete
  (`e2e/toots.spec.ts`, "a Toot whose audio is gone says so, and can't play; one the store fails for
  a moment is kept"; `src/components/farty/toots-provider.interaction.test.tsx`, "marks a saved Toot
  whose audio is gone").
- Toots that fail to load say "Couldn't load your Toots.", and a Toot saved since still lists
  (`e2e/toots.spec.ts`, "Toots that fail to load, and a Toot that isn't there, say so";
  `src/components/farty/toots-provider.interaction.test.tsx`, "reports Toots that fail to load, and
  still lists those saved since").

## Rename and delete

- Each row's More menu has Rename and Delete (`e2e/toots-kept.spec.ts`, "Toots are kept: made,
  found after a relaunch, renamed, and deleted").
- Rename opens a dialog with the title filled in. The new title is trimmed, and a blank one changes
  nothing (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and
  deleted"; `src/components/farty/toots-provider.interaction.test.tsx`, "renames a Toot with its
  title trimmed, and never to nothing").
- A rename shows at once, even when the browser fails to store it (`e2e/toots.spec.ts`, "a Toot
  whose audio is gone says so, and can't play; one the store fails for a moment is kept").
- Delete asks "Delete Mary Had a Little Lamb?", "This can't be undone.", with Cancel and Delete Toot.
  A Toot that plays stops, and the others keep playing without loading their audio again
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted";
  `src/components/farty/toots-provider.interaction.test.tsx`, "stops a Toot that plays before it
  deletes it").

## A Toot's screen

- A row's title opens `/toots/toot/?id=…`: Song Creator's layout without Save, with the Toot's
  title, its Song and source, and the More menu. It opens on Ready, and Play plays it
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").
- Notes and Recordings used play as in [Song Creator](song-creator.md#the-player). A Recording the
  Toot used that was deleted since shows as "Recording deleted", and the Toot still plays
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").
- Audio that couldn't be read shows "Couldn't play" until Play works again. Audio that's gone shows
  "Audio missing", Play is disabled, a tapped note plays nothing, and a line says it can be deleted
  and made again in Compose (`e2e/toots.spec.ts`, "a Toot whose audio is gone says so, and can't
  play; one the store fails for a moment is kept").
- Delete, from the screen, deletes once however fast it's tapped, and goes back to the list
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").
- An id that names no Toot says "Couldn't find this Toot.", or "Couldn't load your Toots." when they
  failed to load. Back to Toots goes back in history when Toots opened the screen, and otherwise
  replaces it (`e2e/toots.spec.ts`, "Toots that fail to load, and a Toot that isn't there, say so";
  `e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").

## Guest and signed in

- A guest's Toots last the visit: they stay through a reload and while Farty is open in another
  tab, and are gone the next time Farty opens (`e2e/guest-visit.spec.ts`, "a guest's Recording
  outlasts closing Farty and still plays, while their Toot lasts the visit";
  `src/lib/visit.test.ts`, "clears a guest's Toots when a new visit opens"; "keeps them while Farty
  is open in another tab"; "keeps the Toots through a reload").
- A visit that can't read the session, offline for one, clears nothing (`src/lib/visit.test.ts`,
  "keeps the first open for the next readable one when get-session %s").
- Signed in, the Toots are kept: they're there after Farty is quit and opened again
  (`e2e/toots-kept.spec.ts`, "Toots are kept: made, found after a relaunch, renamed, and deleted").
- Another browser's Toots, renames and deletes on the account show once this one comes back to
  Farty, without a reload (`e2e/sync.spec.ts`, "two browsers signed in to one account play each
  other's farts, and see each other's deletes"; `src/components/farty/toots-provider.interaction.test.tsx`,
  "takes in what a sync changed, and stops a deleted Toot that plays").

## Offline

- The installed app opens a Toot's screen offline, plays it, and opens it again on a reload
  (`e2e/toots-kept.spec.ts`, "the installed app opens a Toot offline, and plays it").

## Not checked

- The spinner while the Toots load.
- A Toot whose Song has left the Song Catalog says "This Toot's Song isn't in Farty any more."
- Rename from a Toot's screen.
- A Toot that plays keeps playing into its screen, and leaving the Toots tab lets go of the audio
  its rows decoded.
- Hiding the page closes the Rename, Delete and audio-missing dialogs.
