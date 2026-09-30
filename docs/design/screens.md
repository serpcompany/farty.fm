# Screen inventory

Phase 2 of the SERP UI runbook. Approved by the owner in #47 (2026-09-29). The flows are in `app-map.md`, and the clickable version is in `prototype/` (its AI segment is post-MVP).

Reference apps for feel (in place of screenshots): Apple Voice Memos for recording, and Apple Music's library for lists.

---

**SCREEN NAME:** Welcome
**PURPOSE:** Say what Pedos does and ask for the microphone before the first recording.
**HOW USER GETS HERE:** First launch only.
**WHAT'S ON THE SCREEN:**
- App name
- One-line promise: "Record your farts. Turn them into songs."
- Three short points:
  - one fart per Recording
  - each fart has a note
  - collect notes to unlock Songs
- "Allow microphone" button
**PRIMARY ACTION:** Allow microphone.
**SECONDARY ACTIONS:** Not now.
**STATES:** Default.
**NAVIGATION TYPE:** Sheet (not dismissible by swipe).
**PLATFORM NOTE:** Apple default. The system permission prompt follows the button.

---

**SCREEN NAME:** Microphone off
**PURPOSE:** Explain why recording can't start, and how to fix it.
**HOW USER GETS HERE:** Record, when microphone permission is denied.
**WHAT'S ON THE SCREEN:**
- Message: "Pedos needs the microphone to record."
- "Open Settings" button
**PRIMARY ACTION:** Open Settings.
**SECONDARY ACTIONS:** Cancel.
**STATES:** Default.
**NAVIGATION TYPE:** Alert.

---

**SCREEN NAME:** Record
**PURPOSE:** Capture one fart, instantly.
**HOW USER GETS HERE:** Tab 1 (Record). Opens on launch, and whenever the app comes back to the foreground, unless Review or Result is open.
**WHAT'S ON THE SCREEN:**
- **Idle:** one big red button and nothing else
- **Recording:** full screen over the tabs: the button as a Stop square with a pulse, and a timer
**PRIMARY ACTION:** Tap to record, tap again to stop.
**SECONDARY ACTIONS:** None.
**STATES:**
- Idle
- Recording
- Microphone off (alert)
- **Error, couldn't start:** "Couldn't start recording", with Try again
- **Error, interrupted** (a call or another app took the microphone): "Recording stopped. Nothing was saved.", with Try again
- **Nothing heard:** an empty or too-short take goes straight back to Idle with "Didn't catch that. Try again." and nothing to save
**NAVIGATION TYPE:** Tab.
**PATTERN CHOICE:** Recording fills the screen over the tabs, and Stop goes on to Review in the same full-screen cover. Apple's HIG says not to disable tab bar buttons; a modal may cover them.
**NOTES:** The owner asked for "just one big red button" (#47 review).

---

**SCREEN NAME:** Recordings
**PURPOSE:** See and play every Recording and the notes you've collected.
**HOW USER GETS HERE:** Tab 2 (Recordings), or Done after saving.
**WHAT'S ON THE SCREEN:**
- Large title "Recordings"
- **Pitch strip:** a one-octave keyboard (C to B) that lights up each pitch class you've collected, with the count ("7 Melodic Recordings across 6 notes"). Repeats matter because each Song pitch needs its own fart.
- A list of Recordings. Each row has:
  - a play button
  - the name ("Recording 7")
  - a pitch badge ("G♯3", or "noise-like" when the Recording has no steady pitch)
  - its length
  - "first fart used" when a second fart was cut off
**PRIMARY ACTION:** Play a Recording.
**SECONDARY ACTIONS:** Swipe to delete (with confirmation).
**STATES:**
- Empty ("No Recordings yet. Go to the Record tab and tap the red button.")
- Analyzing (the badge shows a spinner)
- Not analyzed (analysis failed; the badge offers Retry)
- Playing (the row is highlighted)
- Populated
**NAVIGATION TYPE:** Tab.
**NOTES:** Renamed from "Shelf", which the owner found confusing. Tapping a row plays it, starting at the fart itself rather than the silence before it.

---

**SCREEN NAME:** Review
**PURPOSE:** Hear the take before keeping it.
**HOW USER GETS HERE:** Tap the Record button again to stop.
**WHAT'S ON THE SCREEN:**
- Waveform
- Play/Stop button
- Length
- Save and Discard buttons
**PRIMARY ACTION:** Save.
**SECONDARY ACTIONS:** Discard, Play.
**STATES:** Default, Playing.
**NAVIGATION TYPE:** Full-screen cover, step 2.

---

**SCREEN NAME:** Result
**PURPOSE:** The payoff: what note did I just make, and what did it unlock?
**HOW USER GETS HERE:** Save. Saving is instant; the analysis runs right after it.
**WHAT'S ON THE SCREEN:**
- **Analyzing:** a short "Finding your note…" state
- **Result for a Melodic Recording:** the big note ("G♯3") and its place on the pitch strip
- **Result for a Noise-like Recording:** "No steady note this time. It's saved, but it can't play melody notes."
- Pitch Coverage changes: "Ode to Joy: 4 of 5 notes covered"
- Unlocks: "You unlocked Twinkle, Twinkle", with a "Try it" button
- Done button
**PRIMARY ACTION:** Done (or Try it when something was unlocked).
**SECONDARY ACTIONS:** Record another.
**STATES:**
- Analyzing
- Melodic, no unlock
- Melodic with an unlock
- Noise-like
- Second fart cut off ("We kept the first fart")
- **Error, save failed** (for example, storage full): "Couldn't save this Recording", with Try again and Discard
- **Error, analysis failed:** "Saved, but we couldn't find its note", with Retry. The Recording stays on the Recordings tab as "not analyzed".
**NAVIGATION TYPE:** Full-screen cover, step 3.

---

**SCREEN NAME:** Compose — Songs
**PURPOSE:** Pick a Song to make, and see what's close to unlocking.
**HOW USER GETS HERE:** Tab 3 (Compose). In the MVP this is the whole tab.
**WHAT'S ON THE SCREEN:**
- (Post-MVP: a segmented control, Songs | AI, above the list)
- Search field
- Sort menu (Closest to unlocking | A–Z)
- **Unlocked** section: rows with the title and "Ready"
- **Locked** section: rows with the title, a progress bar ("3 of 5 notes covered"), a lock and the nearest missing note
- (Unlock rule: one different Melodic Recording per distinct pitch, within 3 semitones. See `app-map.md`.)
**PRIMARY ACTION:** Open an Unlocked Song.
**SECONDARY ACTIONS:** Open a locked Song to see what's missing; search; sort.
**STATES:**
- No Melodic Recordings yet ("Record a few farts with a clear note to start unlocking Songs")
- Some unlocked
- None unlocked
- No search results
**NAVIGATION TYPE:** Tab.

---

**SCREEN NAME:** Locked Song
**PURPOSE:** Show exactly which notes would unlock this Song.
**HOW USER GETS HERE:** Tap a locked Song.
**WHAT'S ON THE SCREEN:**
- Title
- "3 of 5 notes covered"
- The notes still needed, with octave ("Needs a fart near D3 and F3")
- Pitch strip marking the needed pitch classes (it shows note names only, so the text above carries the octave)
- Record button (goes to the Record tab)
- No way to play it until it's unlocked
**PRIMARY ACTION:** Record.
**SECONDARY ACTIONS:** Close.
**STATES:** Default.
**NAVIGATION TYPE:** Sheet (medium detent).

---

**SCREEN NAME:** Song Creator
**PURPOSE:** Hear a Song played by your Recordings, and keep it.
**HOW USER GETS HERE:** Tap an Unlocked Song.
**WHAT'S ON THE SCREEN:**
- Song title
- Source and license line ("Public domain score · PDMX")
- Play/Stop button
- A read-only note view (dots over time, colored by Recording) with a playhead
- The Recordings used, as a list: each with the color of its notes, its name, waveform and length, the note it plays in the Song, and a play button
- Save button, pinned at the bottom
**PRIMARY ACTION:** Save.
**SECONDARY ACTIONS:**
- Play/Stop
- tap a Recording to hear that fart alone; its notes are highlighted
- tap a note to hear just that note as rendered (from the Toot's own audio); it's selected, its Recording is highlighted, and a line says what it is: "F3 · Recording 21 (G3), shifted −2.1 semitones · 1.4 s"
**STATES:**
- Making ("Making your Toot…", about 1–2 s)
- Ready (auto-plays once)
- Playing
- Note selected
- Saved (the Save button reads "Saved to Toots")
- **Error:** couldn't make the Toot, for example a Recording file is missing: "Couldn't make this Toot", with Try again
**NAVIGATION TYPE:** Push.
**NOTES:** Not an editor. Nothing on this screen changes the Arrangement.

---

**SCREEN NAME:** Compose — AI (post-MVP)
**STATUS:** Deferred past the MVP (#21, #22). Kept here for when it returns.
**PURPOSE:** Get a brand-new melody made only from your farts.
**HOW USER GETS HERE:** Tab 3 (Compose), with the AI segment selected.
**WHAT'S ON THE SCREEN:**
- Segmented control
- Mood chips (Happy, Silly, Spooky, Epic)
- Length (Short | Long)
- Compose button
- After composing:
  - Play/Stop
  - the note view
  - Try again and Save buttons
**PRIMARY ACTION:** Compose, then Save.
**SECONDARY ACTIONS:** Try again.
**STATES:**
- Needs more ("AI needs at least 3 Melodic Recordings. You have 2.")
- Ready
- Composing
- Playing
- Saved
- **Error:** composing failed: "Couldn't compose a melody", with Try again
**NAVIGATION TYPE:** Tab + in-place segment.
**NOTES:** The AI approach is decided in #21. This screen only fixes the interaction.

---

**SCREEN NAME:** Toots
**PURPOSE:** Everything you've made.
**HOW USER GETS HERE:** Tab 4 (Toots), or after Save.
**WHAT'S ON THE SCREEN:**
- Rows with a play button, title, origin (the Song's title; "AI · Happy" once AI Song Creator returns), date and length
**PRIMARY ACTION:** Play (the row's play button).
**SECONDARY ACTIONS:** Tap the row to open the Toot. Long-press for Rename or Delete (with confirmation).
**STATES:**
- Empty ("Nothing yet. Make one in Compose.")
- Populated
- Playing
- **Error:** audio missing or unreadable: "This Toot's audio is missing", offering Delete
**NAVIGATION TYPE:** Tab.
**NOTES:** Renamed from "Melodies" by the owner (#52).

---

**SCREEN NAME:** Toot
**PURPOSE:** See and hear which Recording played which notes.
**HOW USER GETS HERE:** Tap a row on the Toots tab.
**WHAT'S ON THE SCREEN:** Song Creator's layout without Save:
- the Toot's title, and its origin (the Song's title and source line)
- Play/Stop and the note view with its playhead
- the Recordings used, as in Song Creator; a Recording deleted since shows as "Recording deleted", with the note it played and no play button
**PRIMARY ACTION:** Play.
**SECONDARY ACTIONS:** Tap a Recording or a note, as in Song Creator. Rename and Delete in the toolbar menu; Delete goes back to the list.
**STATES:** Default, Playing, Note selected, Recording deleted.
**NAVIGATION TYPE:** Push.
**NOTES:** A Toot keeps its Arrangement from when it was made, and plays its own audio.

---

**SCREEN NAME:** Rename
**PURPOSE:** Give a Toot a name.
**HOW USER GETS HERE:** Long-press a Toot, or its screen's menu, then Rename.
**WHAT'S ON THE SCREEN:** A text field, Cancel and Save.
**NAVIGATION TYPE:** Alert with a text field.
**PLATFORM NOTE:** Apple default.
