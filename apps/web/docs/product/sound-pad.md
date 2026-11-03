# Sound Pad

`/compose/pad/`, inside the Compose tab: twelve Pads, each playing one of the person's Recordings at
a tap, raw, as recorded (#277). Record keeps what they play as a Performance, which becomes a Toot
they can hear for free and save like any other (#278,
[ADR 0017](../../../../docs/adr/0017-sound-pad-takes-save-as-toots.md)). It opens from the Sound
Pad's row on [Compose](compose.md#the-sound-pads-row).

## Opening it

- The header has Back to Compose, "Sound Pad" and Edit (`e2e/sound-pad.spec.ts`, "the Sound Pad
  fills with your farts, plays one at a tap, and keeps the Pad you change").
- With no Recordings it says "No Recordings yet" (`e2e/sound-pad.spec.ts`, "the Sound Pad fills
  with your farts, plays one at a tap, and keeps the Pad you change").
- Its address is no Song's (`src/lib/pads.test.ts`, "is no Song’s: `/compose/pad/` comes before
  the Songs’ `/compose/[song]/`"), and it opens offline once Farty is installed
  (`src/lib/service-worker.test.ts`, "never keeps a Song's own page, so offline every Song opens
  on the one Song page").

## The Pads

- Twelve Pads start filled with the Recordings: those on a note first, lowest up, then the rest,
  oldest first. A Pad is named by what it shows, its note then its Recording, as "Pad 1. F2,
  Recording 1", and an empty one "Pad 3. Empty. Choose its fart" (`e2e/sound-pad.spec.ts`, "the
  Sound Pad fills with your farts, plays one at a tap, and keeps the Pad you change";
  `e2e/accessibility.spec.ts`, "the Sound Pad and a Pad's chooser meet WCAG 2.1 AA";
  `src/lib/pads.test.ts`, "puts the Recordings
  on a note first, lowest up, then the rest, oldest first"; "starts with every Pad filled in fill
  order, and the rest empty"; "fills twelve Pads from more Recordings, leaving the rest off").
- A new Recording goes on the first empty Pad, and a Pad whose Recording was deleted is filled
  again (`src/lib/pads.test.ts`, "puts a new Recording on the first empty Pad"; "refills a Pad
  whose Recording was deleted"; "keeps an assigned Pad, and fills the others with the Recordings on
  no Pad").
- A press plays the Pad's fart at once, under 50 ms after the press, raw: at its own pitch and
  speed. Every Pad plays at one level, its loudest sample at −6 dBFS, so two at once can't clip.
  Presses overlap and mix, a finger per Pad (`e2e/sound-pad.spec.ts`, "the Sound Pad fills with your
  farts, plays one at a tap, and keeps the Pad you change"; `src/lib/pads.test.ts`, "puts the
  loudest sample, on any channel, at 0.5 (−6 dBFS)"; "peaks every fixture at 0.5, so no two Pads at
  once go past full scale").
- A Pad plays the fart without the silence and room noise around it: it starts where a Song starts
  that fart and keeps a second, quieter fart after it, with only a 3 ms fade in and 30 ms fade out.
  A take with no sound plays whole (`e2e/sound-pad.spec.ts`, "the Sound Pad fills with your farts,
  plays one at a tap, and keeps the Pad you change"; `src/lib/pads.test.ts`, "starts a noisy take’s
  Pad at its fart, not at the room noise before it (#298)"; "keeps a second, quieter fart"; "keeps
  a silent take whole"; "starts every fixture’s Pad where a Song starts its fart, and keeps the rest
  of its sound"; "plays the span at one gain, with only the 3 ms fade in and 30 ms fade out").
- Each Pad's sound is made ready as soon as its Recording is on it. Until then the Pad shows a
  spinner and a press does nothing, so presses never pile up and start together later
  (`src/components/farty/sound-pad.interaction.test.tsx`, "is dropped while its sound loads, so
  presses never start together later").
- A Recording whose audio this browser doesn't have yet, offline before it downloaded, says "Can’t
  play it yet", isn't reported, and a press tries again. A sound that won't decode is reported
  (`src/components/farty/sound-pad.interaction.test.tsx`, "isn’t reported when the audio isn’t in
  this browser yet, and a press tries again"; "reports a sound that won’t decode";
  `src/lib/audio/pad-player.test.ts`, "fails with PadAudioUnavailable when the download can’t be
  fetched now, and tries again"; "fails with the decode’s own error when the audio won’t decode").

## Edit and the chooser

- Edit, then a tap on a Pad, or a tap on an empty Pad, opens a sheet named for the Pad, "Choose
  the fart it plays.", listing every Recording with its note and length, each named by what it
  shows, as "Recording 1, F2, 0.5 s", the Pad's own marked. A tap there puts that Recording on the
  Pad, and Done ends editing (`e2e/sound-pad.spec.ts`, "the Sound Pad fills with your farts, plays
  one at a tap, and keeps the Pad you change"; `e2e/accessibility.spec.ts`, "the Sound Pad and a
  Pad's chooser meet WCAG 2.1 AA").
- A choice changes only that Pad, and is still there after a reload (`e2e/sound-pad.spec.ts`, "the
  Sound Pad fills with your farts, plays one at a tap, and keeps the Pad you change";
  `src/lib/pads.test.ts`, "changes only the Pad touched, as Recordings come and go";
  `src/lib/pad-store.test.ts`, "survive a reload"; "keep only what was saved last").
- The Pads are this browser's, never synced. They go with the library, and a guest's with their
  visit (`src/lib/pad-store.test.ts`, "clear with the library"; "clear on a guest's new visit, with
  the last visit's farts").

## Recording a take

- Under the Pads, Record says "Play up to 30 s, then hear it back." Tapped, it says "Recording" and
  "It starts at your first tap.", and Edit goes. From the first tap it counts "0:03 of 0:30", with
  "Tap Stop to hear it." (`e2e/sound-pad.spec.ts`, "records a take on the Pads, plays it back, and
  saves it as a Toot for $0.99").
- The take keeps each press that played, timed from the first to the millisecond, and each
  Recording once (`src/components/farty/sound-pad.interaction.test.tsx`, "keeps what played from
  Record to Stop, timed from the first tap, then plays its Toot"; `src/lib/performance.test.ts`,
  "times the taps from the first, to the millisecond, each Recording named once"; "puts taps in time
  order").
- A take holds at most 30 s and 1,000 taps (`src/lib/performance.test.ts`, "keeps
  ${MAX_PERFORMANCE_SECONDS} s and ${MAX_TAPS} taps at most"). Stop before any tap keeps nothing
  (`src/components/farty/sound-pad.interaction.test.tsx`, "is nothing when Stop comes before a
  tap"; `src/lib/performance.test.ts`, "is null for no taps").
- Hiding the page stops the take as Stop does. Its Toot is made, waits on Ready, and never plays
  while the page is hidden or by itself after (`src/components/farty/sound-pad.interaction.test.tsx`,
  "is made, and never plays while hidden or by itself after"; "never plays when the page hides while
  it’s made"; "never plays by itself when the page is back before it’s made").

## Its Toot

- Stop says "Making your Toot…", then plays the Toot once: each tap's fart raw from its start, at
  the tap's time, the taps mixing where they overlap, as long as from the first tap to the end of
  the last fart. Only when taps together would pass full scale is the whole Toot turned down, by one
  gain (`e2e/sound-pad.spec.ts`, "records a take on the Pads, plays it back, and saves it as a Toot
  for $0.99"; `src/lib/engine/render-performance.test.ts`, "starts each tap’s fart at the tap’s
  time, within a sample at 44.1 kHz"; "holds nothing but the Recordings’ own samples: each trimmed,
  faded and at one gain"; "mixes taps that overlap, and ends when the last fart ends"; "turns the
  whole mix down by one gain, rather than clip, when farts together pass full scale";
  `src/lib/toot-renderer.test.ts`, "renders the Performance as the engine does on the same WAVs (ADR
  0017)").
- The made Toot shows Play, Ready or Playing, its length and "5 taps of 2 Recordings", and Record
  again (`e2e/sound-pad.spec.ts`, "records a take on the Pads, plays it back, and saves it as a Toot
  for $0.99").
- One that can't be made says "Couldn't make this Toot.", with Try again and Record again, and is
  reported (`src/components/farty/sound-pad.interaction.test.tsx`, "says it couldn’t be made, and
  reports why"; `src/lib/toot-renderer.test.ts`, "can't be made when a Recording it plays is
  gone"; "can't be made when a Recording's audio is gone"; "can't be made when the render fails").

## Saving a take

- Hearing a take is free. Save to Toots saves it as any Toot is saved, "Save to Toots · $0.99"
  through Checkout ([Paying to save a Toot](payments.md)), and Checkout comes back to the Sound
  Pad. Saved, it's a Toot titled "Sound Pad", with no Song and its Performance
  (`e2e/sound-pad.spec.ts`, "records a take on the Pads, plays it back, and saves it as a Toot for
  $0.99"; `src/app/api/payments-stripe.workers.test.ts`, "starts a Checkout Session for a Sound Pad
  Toot, back to the Sound Pad (ADR 0017)"; `src/app/api/payments.workers.test.ts`, "saves a Sound
  Pad Toot once it is paid for, back to the Sound Pad (ADR 0017)";
  `src/components/farty/toots-provider.interaction.test.tsx`, "saves a Sound Pad Toot with its
  Performance, under the Sound Pad's title").
- A paid Toot of a Song never stands in for a Sound Pad Toot, nor the other way round
  (`src/app/api/payments.workers.test.ts`, "never offers a paid Sound Pad Toot for a Song’s, or a
  Song’s for the Sound Pad").
- Before Checkout the take is kept in this browser, so it can be made again on the way back. Where
  the browser won't keep it, Save starts no Checkout and says "This take can't be saved in this
  browser: it can't keep the take while you pay." (`src/components/farty/song-creator.interaction.test.tsx`,
  "starts no Checkout when the take can’t be kept to make again back from it (ADR 0017)";
  `src/components/farty/sound-pad.interaction.test.tsx`, "can’t be kept for Checkout when storage
  won’t keep it"; `src/lib/pad-take.test.ts`, "say so when storage won’t keep a take, and never
  throw").
- Back from Checkout, the same Toot is made again with the id it was paid for, and waits on Ready.
  A paid take this browser no longer keeps, or one that played a Recording deleted since, says it
  couldn't be made again and is reported; a cancelled return for a take not kept says nothing
  (`src/components/farty/pad-take.interaction.test.tsx`, "is made again with the id it was paid for,
  without playing"; "says a paid take that isn’t kept any more couldn’t be made again, and reports
  it"; "says so too when the paid take played a Recording deleted since"; "clears a cancelled return
  for a take not kept, and says nothing").
- The account keeps a Performance of up to 1,000 taps and 30 s, only its own fields, and refuses
  one this app can't play (`src/app/api/pad-toots.workers.test.ts`, "keep no Song and no
  Arrangement, and their Performance, as the browser sent them"; "keep only a Performance’s own
  fields"; "keep a Performance of 1000 taps, and one 30 s long"; "refuse a Toot of both or neither,
  and a Performance this app can’t play (400)").
- On Toots its row says "Sound Pad", the day and its length, and its screen plays it
  ([Toots](toots.md#a-sound-pad-toot)).

## A kept take

A stopped take is kept in this browser at once, by its Toot id, until it's saved: which Recordings
it played and when, never audio.

- At most 5 takes are kept that never started a Checkout, and 5 that did, the oldest let go first,
  so a new take never pushes out one that may be paid for (`src/lib/pad-take.test.ts`, "are kept by
  Toot id, newest first, as the library’s"; "are at most ${MAX_KEPT_TAKES} with no Checkout, so a
  new take never pushes out one that may be paid for"; "are at most ${MAX_KEPT_TAKES} with a
  Checkout started too, the oldest let go first"; "let go of one take at a time, by its own Toot").
- Opened again, the Sound Pad shows the newest kept take, ready to play. A take since saved is let
  go, and so is one it can't make again where saving is free; where saving is paid, that one stays,
  with Try again, since it may be paid for (`src/components/farty/pad-take.interaction.test.tsx`,
  "shows the newest kept take, and lets go of one saved or that can’t be made"; "lets go of a take
  it can’t make again where saving is free"; "keeps a take it can’t make again where saving is paid,
  and offers to try again"; `src/components/farty/sound-pad.interaction.test.tsx`, "is there again,
  ready to play, when the Pad opens after a phone comes back on Record").
- Where saving is paid, opening the Sound Pad asks the account about each kept take, from what it
  has stored, never Stripe. Paid and not yet used by a save (its return from Checkout never
  loaded), the take is made again and saved, paid for once. Used, it's let go and taken off the Pad.
  Unpaid, or not known yet, it stays, and the next open asks again (`e2e/sound-pad.spec.ts`, "saves
  a paid take on the next open when the return from Checkout never loaded, paying once";
  `src/components/farty/pad-take.interaction.test.tsx`, "saves a paid take whose return from
  Checkout never loaded, and lets go of a used one"; "takes a take off the Pad once its payment
  turns out used, so it never asks to pay again"; `src/app/api/payments.workers.test.ts`, "says a
  payment is unused until a save uses it, so a kept take saves only then (ADR 0017)";
  `src/app/api/payments-stripe.workers.test.ts`, "answers the Sound Pad’s check on open from D1
  alone, never asking Stripe (ADR 0017)"; `src/lib/toot-payment.test.ts`, "is unused only for a
  payment no save has used, and null when the server can’t say").
- A paid take that can't be made again, its Recording deleted since or the storage cleared, says
  "Your payment went through, but this take couldn't be made again here. Contact support for a
  refund.", and is reported (`src/components/farty/pad-take.interaction.test.tsx`, "says a paid
  take whose Recording was deleted can’t be made again, and reports it").
- Signed in again, a paid take waits for the account's changes to be read, as its Recordings may
  still be on their way: it's saved once they arrive, and called lost only once the read finds
  them gone (`src/components/farty/pad-take.interaction.test.tsx`, "keeps a paid take whose
  Recordings aren’t here yet, and saves it once they are"; "saves it when they arrive before the
  account says it’s paid"; "says it’s lost, and reports it, once read without its Recording";
  "waits for them back from Checkout too").
- Record pressed meanwhile keeps the waiting take for the next open, and a kept take never takes
  the place of one being recorded (`src/components/farty/pad-take.interaction.test.tsx`, "keeps a
  take it’s waiting for when Record is pressed meanwhile"; "never takes the place of a take being
  recorded").
- Each take is the library's it was made in: another account's or a guest's never shows, nor
  starts a Checkout (`src/components/farty/pad-take.interaction.test.tsx`, "never shows another
  account’s take, nor a guest’s, to this one"; `src/lib/pad-take.test.ts`, "are only ever the
  library’s own: never another account’s, nor a guest’s"; "never start a Checkout paid by another
  account than the library’s").
- A guest's takes last the visit, and join the account they sign in to. Sign out, or another
  account's sign-in, lets go of the takes that never started a Checkout; one that did is back with
  its account (`src/lib/visit.test.ts`, "go as a guest’s new visit opens, and stay on a reload";
  "join the account a guest signs in to, as its Recordings do"; "that never started a Checkout go on
  Sign out; one that did is back when the account is"; "that never started a Checkout go with
  another account’s library; one that did stays for it"; `src/lib/pad-take.test.ts`, "go with the
  library, but those a Checkout started stay for their account"; "of a guest’s visit go with it,
  and join the account the guest signs in to").

## Not checked

- Leaving the Sound Pad, or hiding the page, stops every Pad and closes the chooser.
- On iPhone, a Pad's first sound when audio isn't running yet (opening `/compose/pad/` directly, or
  after the page was hidden) starts on the tap's release, since WebKit doesn't count a press as a
  tap that may start audio: only a real iPhone shows it.
- The keyboard's Enter or Space plays a focused Pad.
