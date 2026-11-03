# Review

One review for every take (#314): right after Stop, before Save, and later from a saved Recording's
pencil on the [Recordings](recordings.md) tab. It sets the Recording's Trim, note and name. Saving
never waits on Recording Analysis (ADR 0002). Placing a fart on a note by ear is ADR 0015, and the
Trim ADR 0019.

## After Stop

- The review opens as soon as Stop finishes, titled "New Recording", while analysis finds the note.
  It shows the take as the Recording it will be, numbered after the last
  (`src/components/farty/record-flow-provider.interaction.test.tsx`, "records a take and shows it
  for review"; `src/components/farty/record-flow.interaction.test.tsx`, "plays the take on review
  between its handles, numbered after the last Recording").
- Its analysis starts at Stop, on the WAV it will save as, so it finds what a saved Recording's
  would. The note shows once found (`src/components/farty/record-flow-provider.interaction.test.tsx`,
  "finds the note of the take on review from Stop, before it is saved").
- Discard throws the take away and saves nothing (`src/components/farty/take-review.interaction.test.tsx`,
  "throws the take away with Discard, saving nothing").
- No new take starts while the review shows (`src/components/farty/record-flow-provider.interaction.test.tsx`,
  "starts no take while Review shows").
- On a phone it covers the screen; from 768px it is a card under the top bar, whose tabs wait for it
  (`e2e/lander.spec.ts`, "Recording, Review and Result are a card under the top bar, whose tabs
  wait for them").

## The Trim

- The whole take's waveform, with pink handles at each end of the part kept and the rest shaded.
  They open on the Recording's Trim, or the fart analysis found, or the whole take while it's still
  finding it. "Drag the pink ends to trim" says what they do (`src/lib/take-review.test.ts`, "open on
  the Trim, or the fart analysis found, or the whole take while finding";
  `src/components/farty/take-review.interaction.test.tsx`, "opens the handles on the fart found,
  trims, resets, and saves the Trim").
- Each handle is a slider of its own, beside the waveform: "Where the fart starts" and "Where the
  fart ends". Drag one, or focus it and use the arrow keys, a hundredth of a second a press, a tenth
  with Shift. The length between them shows in hundredths ("0.60 s")
  (`src/components/farty/waveform.interaction.test.tsx`, "puts the Trim's handles beside the slider,
  each its own slider with arrow keys"; `src/components/farty/take-review.interaction.test.tsx`,
  "opens the handles on the fart found, trims, resets, and saves the Trim").
- Play plays between the handles, and becomes Stop while it plays. "Reset to the fart Farty found"
  shows once the handles moved, and puts them back (`src/components/farty/record-flow.interaction.test.tsx`,
  "plays the take on review between its handles, numbered after the last Recording";
  `e2e/record-noise.spec.ts`, "a Noise-like fart can be trimmed in its review, and the row then
  plays just that part (ADR 0019)").
- Any Recording can be trimmed, a Melodic one too. Handles left on the fart analysis found keep no
  Trim, and handles reset on a trimmed Recording take its Trim off (`src/lib/take-review.test.ts`,
  "trim a Melodic Recording, keep a Trim, and take it off back on the fart found";
  `src/components/farty/take-review.interaction.test.tsx`, "trims a Melodic Recording, and stays
  open saying so when the fart can’t be found").
- What Songs play is the fart Farty finds between the handles, and its length is what a locked
  Song's "Needs" is measured against. The take itself never changes ([Recordings](recordings.md#playing);
  `src/lib/analysis/trim.test.ts`, "finds the fart between the handles, and always within them";
  `src/lib/pitch-coverage.test.ts`, "is its Trim’s fart once trimmed, Melodic or not (#314)").

## The note

- Above one octave of piano keys, the note: "Finding note…", the note found, a note picked, "No
  note", or "Not found" when analysis failed. The keys open on octave 3 and move to the octave of
  the note found, unless a key was picked; the octave arrows go from C2 to B4
  (`src/lib/take-review.test.ts`, "is \"Finding note…\" until analysis lands, then the note it found
  or \"No note\""; `src/components/farty/take-review.interaction.test.tsx`, "moves the keys to the
  octave of the note found, unless the user picked one"; `e2e/record-noise.spec.ts`, "a Noise-like
  fart is given a note in its review, moved, and left out again (ADR 0015)").
- A key plays a short piano note to hold the fart up to, and makes that the note. The note found
  stays ringed, and "Back to G3" returns to it. Only the review plays the piano; Songs and Toots stay
  fart-only (`src/components/farty/take-review.interaction.test.tsx`, "shows the note found, and a
  key makes another the note, until Back to G3"; `src/lib/take-review.test.ts`, "makes a key the
  note, or follows analysis again on the note it found").
- "No note" leaves the Recording out of Songs, a Melodic one included, and a second tap takes it
  back off (`src/components/farty/take-review.interaction.test.tsx`, "leaves a fart out with \"No
  note\", and takes it back off"; `src/lib/take-review.test.ts`, "turns \"No note\" on, and off again
  back to the note analysis found").
- A Noise-like take says "No steady note found, so Songs leave it out. Tap a key if you hear one."
  A key gives it a Placed Pitch: "Set by you. Tap another key to change it."
  (`src/components/farty/take-review.interaction.test.tsx`, "says a Noise-like take has no note, and
  a key gives it one").
- A line under the keys says what the note means for Songs: "You can save now. The note shows here
  once it's found.", "We heard G3. Tap a key to hear it and make it the note.", or "Changed from G3.
  Back to G3" (`src/components/farty/take-review.interaction.test.tsx`, "saves at once while the note
  is still being found, with the name typed"; `e2e/review.spec.ts`, "a take trimmed, moved to
  another note and named in its review keeps them").
- When analysis fails, the note says "Not found" and "We couldn't find its note. Tap a key if you
  hear one." Retry shows only once the take is saved, as on the Result
  (`src/components/farty/take-review.interaction.test.tsx`, "says it couldn’t find the note when
  analysis fails, as Result does"; "says it couldn’t find the note when not analyzed, with Retry, as
  Result does").
- A Placed Pitch is kept only where it differs from the note analysis found
  (`src/lib/take-review.test.ts`, "keeps a Placed Pitch only where it differs from analysis").

## The name

- A Name field, "Recording 7" until another is typed. An empty name, or the default, keeps none,
  and a name keeps at most 40 characters (`src/components/farty/take-review.interaction.test.tsx`,
  "saves at once while the note is still being found, with the name typed"; "takes the name off when
  it is emptied, back to \"Recording 7\""; `src/lib/take-review.test.ts`, "keeps no name for an empty
  one or the default, and at most 40 characters").
- A saved Recording's review is titled with its name, which follows what's typed
  (`src/components/farty/take-review.interaction.test.tsx`, "renames it and sets the note at once,
  the title following the name").

## Saving

- Save keeps the take at once, with the note and name the review changed, while the note is still
  being found. Its Trim and analysis follow, and the Result waits for them
  (`src/components/farty/take-review.interaction.test.tsx`, "saves at once while the note is still
  being found, with the name typed"; `src/components/farty/record-flow-provider.interaction.test.tsx`,
  "saves the take, finds its note and shows what it changed").
- While Farty still reads the session for this visit, Save stays disabled until it knows whose
  library this is (`e2e/guest-visit.spec.ts`, "a Recording saved while Farty still reads the session
  waits for the visit to start").
- When the fart between the handles can't be found, the take is kept whole, and the Result says
  "Couldn't save the trim, so it's kept whole. Trim it again from the Recordings tab." It still says
  so after Retry (`src/components/farty/take-review.interaction.test.tsx`, "says on Result when the
  fart between the handles couldn’t be found to trim"; "still says the take was kept whole after
  Retry, when the Trim and the analysis both failed").
- A save that fails says "Couldn't save this Recording", with Discard and Try again, keeping what the
  review changed (`src/components/farty/record-flow-provider.interaction.test.tsx`, "offers to save
  again when the save failed"; `src/components/farty/record-flow.interaction.test.tsx`, "says it
  couldn't save the Recording, with Discard and Try again").
- While a take is unsaved, a reload after a deploy waits for it ([App shell](app-shell.md#a-new-deploy);
  `src/components/farty/record-flow-provider.interaction.test.tsx`, "holds off a new build until
  the flow closes").
- The Trim, note and name stay through the Result, the Recordings tab, a reload and the account
  (`e2e/review.spec.ts`, "a take trimmed, moved to another note and named in its review keeps
  them").
- The take plays from one decode however often the review plays it, and is let go once the review
  closes (`src/components/farty/record-flow-provider.interaction.test.tsx`, "plays the take on
  review from one decode, and lets it go once the review closes").

## A saved Recording's review

- A Recording's pencil ("Edit Recording 1") opens the same review, titled with its name, on its
  Placed Pitch, Trim and name, with Cancel and Save. Cancel changes nothing
  (`src/components/farty/take-review.interaction.test.tsx`, "opens on its Placed Pitch, its Trim and
  its name, and Cancel changes nothing"; `src/components/farty/recordings-screen.interaction.test.tsx`,
  "names a Recording by the name the user gave it, and its pencil opens its review").
- It's a modal: focus moves in and stays in, Escape is Cancel and keeps nothing the review changed,
  and focus goes back to the pencil. The tabs wait while it shows. A tap beside the card doesn't
  close it (`e2e/record-noise.spec.ts`, "a Recording’s review is a modal: focus moves in and stays
  in, Escape is Cancel, focus goes back (#314)"; `src/components/farty/recordings-screen.interaction.test.tsx`,
  "opens its review as a modal: focus moves in, Escape is Cancel, focus goes back").
- Save changes only what the user changed, at once, and waits only to find the fart between moved
  handles. When that fails it stays open and says "Couldn't save the trim. Try again."
  (`src/lib/take-review.test.ts`, "changes only what the user changed";
  `src/components/farty/take-review.interaction.test.tsx`, "trims a Melodic Recording, and stays
  open saying so when the fart can’t be found"; `src/components/farty/recordings-provider.interaction.test.tsx`,
  "saves nothing, and says it didn't, when the fart between the handles can't be found").
- A Recording not analyzed says "We couldn't find its note. Tap a key if you hear one, or Retry",
  and Retry finds it there (`src/components/farty/take-review.interaction.test.tsx`, "says it
  couldn’t find the note when not analyzed, with Retry, as Result does").
- Hiding the page closes it, since Farty comes back on the Record tab
  (`src/components/farty/recordings-screen.interaction.test.tsx`, "closes the review when the page
  is hidden").
- Signed in, the Trim, note and name reach the account and every other browser on it
  ([Sync](sync.md)).

## Not checked

- A tap on the waveform inside the fart plays to the fart's end; after it, to the end of the take.
- When analysis lands while the review is open, the handles follow it unless the user moved them.
- The handles never leave less than 0.05 s between them.
