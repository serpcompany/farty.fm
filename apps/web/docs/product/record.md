# Record

The Record tab and the record flow it opens: the microphone, a take, Review, saving, finding the
note, and the Result. Phones and touch tablets record; a computer gets the product page
([First visit](first-visit.md)). How capture works, and why the microphone behaves as it does on
iPhone, is in [Web app gotchas](../../../../docs/agents/web-gotchas.md). The journeys play a fixture
as a fake microphone.

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
- The button says "Starting…" until audio comes in (`e2e/record-warm.spec.ts`, "the button says
  Starting… until audio comes in").

### Hiding the page, and interruptions

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
  interruption while the microphone opens is heard too (mute)"; "an interruption while the
  microphone opens is heard too (ended)").

## Recording

- A tap on Record stops whatever plays and covers the screen with a Stop button and a timer
  (minutes and seconds). From 768px it is a card under the top bar (`src/components/farty/record-flow-provider.interaction.test.tsx`,
  "records a take and shows it for review"; `e2e/lander.spec.ts`, "Recording, Review and Result are
  a card under the top bar, whose tabs wait for them").
- Stop ends the take. A take that heard nothing is dropped, and Record says "Didn't catch that. Try
  again." A fart counts when its loudest 50 ms reaches −50 dBFS and stands 4 dB over the room
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "says it didn't catch a take
  with nothing in it"; `e2e/record-interrupted.spec.ts`, "a kept stream that comes back silent is
  opened afresh by the next tap"; `src/lib/recordings.test.ts`, "hears every fart in the Fixture
  Library"; "hears nothing in 2 s of silence"; "hears nothing in 2 s of room noise at %i dBFS").
- A call or another app that takes the microphone loses the take: "Recording stopped", "Nothing was
  saved.", with Try again (`src/components/farty/record-flow-provider.interaction.test.tsx`, "loses
  the take when another app takes the microphone").
- A refused microphone says "Microphone is off" and how to allow it in the browser's site settings,
  with Cancel only. Any other failure says "Couldn't start recording", with Try again. Both are
  reported. A microphone let go just before the take began says nothing
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "explains a microphone that
  would not start (%s)"; "says nothing when the microphone was let go before the take began").

## Review

- "New Recording": the take's waveform and length, Play, Discard and Save. Play turns into Stop
  while the take plays, and Discard drops it (`src/components/farty/record-flow-provider.interaction.test.tsx`,
  "records a take and shows it for review"; `e2e/record-warm.spec.ts`, "a tap captures at once,
  keeps the fart from before it, and the mic opens once per launch").
- No new take starts while Review shows (`src/components/farty/record-flow-provider.interaction.test.tsx`,
  "starts no take while Review shows").
- Save keeps the Recording in this browser at once; nothing waits on its analysis. While Farty still
  reads the session for this visit, Save stays disabled until it knows whose library this is
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "saves the take, finds its
  note and shows what it changed"; `e2e/guest-visit.spec.ts`, "a Recording saved while Farty still
  reads the session waits for the visit to start").
- A save that fails says "Couldn't save this Recording", with Discard and Try again
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "offers to save again when the
  save failed").
- While a take is unsaved, a reload after a deploy waits for it ([App shell](app-shell.md#a-new-deploy);
  `src/components/farty/record-flow-provider.interaction.test.tsx`, "holds off a new build until
  the flow closes").

## Finding the note

- The flow is titled with the new Recording's name ("Recording 1") while Recording Analysis runs
  (`e2e/lander.spec.ts`, "Recording, Review and Result are a card under the top bar, whose tabs
  wait for them").
- An analysis that fails says "Saved, but we couldn't find its note" and that it's on the
  Recordings tab as not analyzed, with Done and Retry. Done goes to Recordings, and Retry runs it
  again (`e2e/tabs.spec.ts`, "a Recording that could not be analyzed says so, and Retry finds its
  note"; `src/components/farty/record-flow-provider.interaction.test.tsx`, "retries a Recording
  whose note couldn't be found").

## The Result

- A Melodic Recording shows "Your note" and its Recording Pitch (such as G3), over a strip of the 12
  pitch classes with the collected ones filled and the new one outlined (`e2e/record-melodic.spec.ts`,
  "recording a Melodic fart shows its note, and it is still there after a reload";
  `e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and the Result says so").
- A Noise-like Recording shows "No steady note this time": it's saved, but it can't play melody
  notes (`e2e/record-noise.spec.ts`, "recording a Noise-like fart says it has no steady note").
- A take with more than one fart keeps the first and says "We kept the first fart"
  (`e2e/record-two-farts.spec.ts`, "recording two farts keeps the first and says so").
- What the save changed: each Song it unlocked ("You unlocked Mary Had a Little Lamb"), up to two
  Songs it brought closer with their Pitch Coverage, or else the Song closest to unlocking when
  there are Melodic Recordings (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose, and
  the Result says so"; `src/lib/pitch-coverage.test.ts`, "lists the unlocks, then the improvements
  closest first"; "shows no unlock for a Noise-like save, and the Song closest to unlocking"; "has
  no Song closest to unlocking once every Song is unlocked").
- With an unlock, the buttons are Done, to Recordings, and Try it, which opens the first Song it
  unlocked in Song Creator and starts audio in the tap, so the Toot plays once made. Without one,
  they are Record another and Done (`e2e/compose.spec.ts`, "saving farts unlocks Songs on Compose,
  and the Result says so"; `e2e/record-warm.spec.ts`, "the microphone stays open from Result to
  every screen after it").
- A guest's first Result offers the account step before going where they tapped
  ([Accounts](account.md#when-the-step-opens)). The first saved Recording brings the install offer
  once the flow closes ([Installing and offline](install.md#the-install-offer)).

## Not checked

- A take stops by itself at 30 s.
- The words and buttons of the "Microphone is off", "Couldn't start recording" and "Recording
  stopped" alerts, and of "Couldn't save this Recording": the tests check which problem the flow
  is in, not what it shows.
- "Finding your note…" while Recording Analysis runs.
- Three or more Songs unlocked by one save show as one card, "You unlocked 3 Songs", with their
  titles.
