# Record

The Record tab and the record flow it opens: the microphone, a take, saving, finding the note, and
the Result. The review between Stop and Save is in [Review](review.md). Phones and touch tablets
record; a computer gets the product page ([First visit](first-visit.md)). How capture works, and why
the microphone behaves as it does on iPhone, is in
[Browser gotchas](../../../../docs/agents/browser-gotchas.md). The journeys play a fixture as a fake
microphone.

## The Record tab

- One big red Record button, and under it a line that is empty until a take hears nothing
  (`e2e/tabs.spec.ts`, "the app opens on Record, and every tab works before the first Recording").
- With no grant yet, the microphone opens on the first tap, not when Farty opens
  (`e2e/record-first-tap.spec.ts`, "the microphone opens on the first tap, not when Farty opens").
- Once granted, Record opens the microphone as it shows, so a tap captures at once and keeps the
  start of a fart that began just before it. The microphone opens once per launch
  (`e2e/record-warm.spec.ts`, "a tap captures at once, keeps the fart from before it, and the mic
  opens once per launch").
- Opened on another tab, Farty opens the microphone only once Record shows. Once open, it stays open
  on every screen after it, the Result and Song Creator included (`e2e/record-warm.spec.ts`,
  "opened on another tab, Farty opens the microphone only once Record shows"; "the microphone stays
  open from Result to every screen after it").

## Getting the mic ready

- A tap covers the screen, tabs included, with a grey "Getting the mic ready…" and a spinner where
  the Record button was, and "The screen turns red when it's recording." It stays grey until the
  take's audio reaches the page, never red before (`e2e/record-states.spec.ts`, "Getting the mic
  ready until audio reaches the page, then the red Recording screen";
  `src/components/farty/record-states.interaction.test.tsx`, "shows Getting the mic ready until the
  take’s audio comes in, and only then turns red").
- It's seen on a tap before the microphone is open: the first tap before permission, or a tap as the
  screen opens (`e2e/record-warm.spec.ts`, "Getting the mic ready shows until audio comes in").
- With the microphone already open, a tap turns red within a frame or two: the journeys measure the
  median from tap to red under 500 ms (`e2e/record-states.spec.ts`, "turns red as the first audio
  arrives, and never before it: tap to red, measured").

## Recording

- A tap on Record stops whatever plays. Once the take's audio comes in, the whole screen turns red,
  with a large "Recording", a timer in tenths and a white Stop button. From 768px it is a card under
  the top bar (`src/components/farty/record-states.interaction.test.tsx`, "shows Getting the mic
  ready until the take’s audio comes in, and only then turns red"; "counts the timer in tenths";
  `src/components/farty/record-flow-provider.interaction.test.tsx`, "records a take and shows it for
  review"; `e2e/lander.spec.ts`, "Recording, Review and Result are a card under the top bar, whose
  tabs wait for them").
- The phone buzzes once as the screen turns red, where the browser can vibrate (not Safari on
  iPhone). A microphone that fails to start never turns the screen red or buzzes
  (`src/components/farty/record-states.interaction.test.tsx`, "shows Getting the mic ready until the
  take’s audio comes in, and only then turns red"; "never turns red, or buzzes, when the microphone
  fails to start").
- The take's waveform draws live under the timer: a bar per 50 ms, tall for the fart and flat for the
  room, the newest at the right (`src/components/farty/record-states.interaction.test.tsx`, "draws
  the take’s waveform live: a bar per 50 ms, tall for the fart, flat for the room";
  `e2e/record-states.spec.ts`, "the waveform moves with the fart and falls back after it, with no
  hint").
- After about 2 s with nothing louder than the room, "Can't hear anything. Move closer." shows under
  the waveform, and the take goes on. The hint uses Stop's own test, so a take it calls silent is
  the one Stop drops, and a take it hears never gets it
  (`src/components/farty/record-states.interaction.test.tsx`, "says it can’t hear anything after 2 s
  of room, without stopping the take"; "agrees with Stop: a take it can’t hear is the one Stop
  refuses"; "never hints at a take it hears, and Stop keeps it"; `e2e/record-states.spec.ts`, "a
  take that hears nothing says so after 2 s, goes on, and Stop agrees").
- After Stop, Stop dims and the timer and waveform hold while the take finishes. Nothing carries
  over from an interrupted take to the next (`src/components/farty/record-states.interaction.test.tsx`,
  "dims Stop and holds the timer and waveform while the take finishes after Stop"; "lets an
  interrupted take go: no waveform and no hint carry over to the next").
- Stop ends the take and opens the [Review](review.md). A take that heard nothing is dropped, and
  Record says "Didn't catch that. Try again."
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "says it didn't catch a take
  with nothing in it"; `e2e/record-interrupted.spec.ts`, "a kept stream that comes back silent is
  opened afresh by the next tap").
- A take stops by itself at 30 s, as if Stop were tapped
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "stops a take by itself at
  30 s").

## Quiet takes

The browser's voice processing is off, so a take is the microphone's own level, which can be quiet.

- A fart counts when its loudest 50 ms reaches −70 dBFS and stands 4 dB over the take's own room.
  Every Fixture Library fart turned down until its loudest sample is at −50 dBFS is heard; room noise
  and silence are not. A low rumble can pass, and analysis then finds no steady note
  (`src/lib/recordings.test.ts`, "hears every fart in the Fixture Library"; "hears every fart in the
  Fixture Library with its loudest sample at -50 dBFS (#279)"; "hears no fart with its loudest sample
  below -70 dBFS"; "hears nothing in 2 s of silence"; "hears nothing in 2 s of room noise at %i
  dBFS"; "$noise for $seconds s at $rmsDb dBFS: heard is $heard").
- A heard take is saved turned up by one gain until its loudest sample is at about −1 dBFS, never
  turned down, so the review, the Recordings tab and Songs play it as loud as any. Recording Analysis
  finds the same on either level (`e2e/record-quiet.spec.ts`, "a fart 50 dB below full level is
  heard, saved at full level and analyzed as it is"; `e2e/record-warm.spec.ts`, "a tap captures at
  once, keeps the fart from before it, and the mic opens once per launch"; `src/lib/recordings.test.ts`,
  "turns a quiet take up with one gain, so its loudest sample is at about -1 dBFS"; "never turns a
  take down, and leaves silence silent"; "gives Recording Analysis the same results on every fart in
  the Fixture Library").

## When a take fails

- A call or another app that takes the microphone loses the take: "Recording stopped", "Nothing was
  saved.", with Cancel and Try again (`src/components/farty/record-flow-provider.interaction.test.tsx`,
  "loses the take when another app takes the microphone"; `src/components/farty/record-screen.interaction.test.tsx`,
  "says in words what went wrong (%s), with its buttons").
- A refused microphone says "Microphone is off" and how to allow it in the browser's site settings,
  with Cancel only. Any other failure says "Couldn't start recording", with Cancel and Try again.
  Both are reported. A microphone let go just before the take began says nothing
  (`src/components/farty/record-screen.interaction.test.tsx`, "says in words what went wrong (%s),
  with its buttons"; `src/components/farty/record-flow-provider.interaction.test.tsx`, "says nothing
  when the microphone was let go before the take began").
- A take whose audio clock stands still, as on an iPhone after the app was away, tries once more by
  itself on a fresh stream and audio context, and records. If that stands still too, it says
  "Couldn't start recording", and the next tap records (`src/lib/audio/recorder.test.ts`, "tries once
  more by itself, on a fresh stream and context, and records"; "says it couldn’t start when the
  second try stands still too, and the next tap records").
- A take whose stream fed nothing says "Couldn't start recording" without trying again, and the next
  tap opens a fresh stream. Between takes, the microphone and context stay
  (`src/lib/audio/recorder.test.ts`, "opens a fresh stream on the next tap, without trying again by
  itself"; "keeps the microphone and context between takes while the page shows").

### Hiding the page, and interruptions

- Back from the background or from the back-forward cache, the first tap records at once on the
  stream it kept, though the old audio context stood still. A sound that started while the page was
  hidden ends as the page shows (`e2e/record-grant.spec.ts`, "the first tap after coming back
  records at once, though the old context stood still"; "a sound that started while the page was
  hidden ends as the page shows"; `src/lib/audio/recorder.test.ts`, "records at once after the app
  was in the background, keeping the stream"; "records at once in a tab opened again from the
  back-forward cache").
- A browser that would keep listening while the page is hidden has the microphone closed, and
  opened again when the page shows (`e2e/record-warm.spec.ts`, "a browser that would listen while
  the page is hidden closes the microphone, and stays open on the other tabs").
- A microphone that the browser mutes while the page is hidden is kept, unless it unmutes before
  the page shows. Hidden longer than the grant lasts without a tap, the microphone waits for the
  Record tap; lost while hidden, it opens again as the page shows, within that window
  (`e2e/record-grant.spec.ts`, "hidden and shown again, the page keeps its microphone: no new
  getUserMedia"; "a microphone that unmutes while the page is hidden is let go"; "a microphone that
  unmutes as the page shows is kept"; "hidden longer than the grant lasts outside a tap, the
  microphone waits for the Record tap"; "a microphone lost while hidden opens again as the page
  shows, inside the window").
- After an interruption such as Siri or a call banner, the next tap opens the microphone afresh, or
  captures on the same one once the interruption is over. A kept stream that comes back silent is
  opened afresh (`e2e/record-interrupted.spec.ts`, "after an interruption mutes the microphone, the
  next tap opens it afresh"; "once an interruption is over, the next tap captures on the same
  microphone"; "a kept stream that comes back silent is opened afresh by the next tap"; "an
  interruption while the microphone opens is heard too (${event})").

## Finding the note

- Save in the review keeps the Recording at once ([Review](review.md#saving)). The flow is then
  titled with the Recording's name ("Recording 1") and says "Finding your note…" until Recording
  Analysis and the Trim are done (`e2e/lander.spec.ts`, "Recording, Review and Result are a card
  under the top bar, whose tabs wait for them"; `src/components/farty/record-flow.interaction.test.tsx`,
  "says Finding your note… while Recording Analysis runs").
- An analysis that fails says "Saved, but we couldn't find its note" and that it's on the
  Recordings tab as not analyzed, with Done and Retry. Done goes to Recordings, and Retry runs it
  again (`e2e/tabs.spec.ts`, "a Recording that could not be analyzed says so, and Retry finds its
  note"; `src/components/farty/record-flow-provider.interaction.test.tsx`, "retries a Recording
  whose note couldn't be found").

## The Result

- A Recording with a note shows "Your note" and the note Songs use, a Placed Pitch picked in the
  review included (such as G3), over a strip of the 12 pitch classes with the collected ones filled
  and the new one outlined (`e2e/record-melodic.spec.ts`, "recording a Melodic fart shows its note,
  and it is still there after a reload"; `e2e/review.spec.ts`, "a take trimmed, moved to another
  note and named in its review keeps them"; `e2e/compose.spec.ts`, "saving farts unlocks Songs on
  Compose, and the Result says so").
- A Noise-like Recording, or one left out with "No note" in the review, shows "No note": it's saved,
  and Songs leave it out until it's given a note from the Recordings tab
  (`e2e/record-noise.spec.ts`, "recording a Noise-like fart says it has no note").
- A take with two farts keeps both: the Result says nothing about a second fart
  (`e2e/record-two-farts.spec.ts`, "recording two farts keeps both, and replay plays the whole
  take").
- When the review's Trim couldn't be saved, the Result says "Couldn't save the trim, so it's kept
  whole." ([Review](review.md#saving)).
- What the save changed: each Song it unlocked ("You unlocked Mary Had a Little Lamb"), up to two
  Songs it brought closer with their Pitch Coverage, or else the Song closest to unlocking when
  there are Melodic Recordings (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and
  the Result says so"; `src/lib/pitch-coverage.test.ts`, "lists the unlocks, then the improvements
  closest first"; "shows no unlock for a Noise-like save, and the Song closest to unlocking"; "has
  no Song closest to unlocking once every Song is unlocked").
- One or two unlocked Songs each have a card. Three or more show as one card, "You unlocked 3
  Songs", with their titles (`src/components/farty/record-flow.interaction.test.tsx`, "shows each of
  two Songs unlocked by one save on its own card"; "shows three or more Songs unlocked by one save
  as one card, with their titles").
- With an unlock, the buttons are Done, to Recordings, and Try it, which opens the first Song it
  unlocked in Song Creator and starts audio in the tap, so the Toot plays once made. Without one,
  they are Record another and Done (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose,
  and the Result says so"; `e2e/record-warm.spec.ts`, "the microphone stays open from Result to
  every screen after it").
- Share is at the top right once the take is saved, as on the Recording's row. A guest makes a free
  account first ([Sharing](sharing.md); `src/components/farty/take-review.interaction.test.tsx`,
  "offers Share once the take is saved, and a guest makes an account first (#320)";
  `e2e/share-recording.spec.ts`, "a guest records, reviews and saves, then shares from Result once
  they've made an account, and someone signed out plays it (#320)").
- A flow whose Recording leaves the library, because another tab signed out or a sync deleted it,
  closes, so the tabs and Record work again
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "closes when its Recording
  leaves the library, so Record works again").
- A guest's first Result offers the account step before going where they tapped
  ([Accounts](account.md#when-the-step-opens)). The first saved Recording brings the install offer
  once the flow closes ([Installing and offline](install.md#the-install-offer)).
