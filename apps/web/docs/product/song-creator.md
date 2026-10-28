# Song Creator

`/compose/<song>/`: an Unlocked Song played with the person's own Recordings, as a Toot they can
play, take apart note by note, and save. Auto-map chooses the Arrangement and each Recording plays
raw, at its own pitch and speed ([ADR 0005](../../../../docs/adr/0005-song-creator-is-automatic.md),
[ADR 0012](../../../../docs/adr/0012-songs-play-farts-raw.md)). A saved Toot is on the
[Toots](toots.md) tab; paying to save one is in [Paying to save a Toot](payments.md).

## Opening it

- The header has Back to Compose, the Song's title and its source. "Making your Toot…" shows while
  the Toot renders (`e2e/song-creator.spec.ts`, "plays each Song with your farts, plays a tapped
  note, and saves it as a Toot").
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
  found, on no tab").
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

- Save to Toots saves the Toot to an account. It says "Save to Toots · $0.99" and goes through
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
