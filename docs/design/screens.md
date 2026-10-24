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
**HOW USER GETS HERE:** Tab 3 (Record), in the center of the tab bar. Opens on launch, and whenever the app comes back to the foreground, unless Review or Result is open.
**WHAT'S ON THE SCREEN:**
- **Idle:** one big red button and nothing else
- **Recording:** full screen over the tabs: the button as a Stop square with a pulse, and a timer
**PRIMARY ACTION:** Tap to record, tap again to stop.
**SECONDARY ACTIONS:** None.
**STATES:**
- Idle
- Starting (web)
- Recording
- Microphone off (alert)
- **Error, couldn't start:** "Couldn't start recording", with Try again
- **Error, interrupted** (a call or another app took the microphone): "Recording stopped. Nothing was saved.", with Try again
- **Starting:** on the web, a tap before the microphone is open (the first tap before permission, or a tap as the screen opens) shows "Starting…" on the button until audio comes in. Once Record has shown, the microphone stays open for the rest of the launch while the page shows, through Review, Result and the other tabs, so later taps capture at once, with the 300 ms before the tap.
- **Nothing heard:** a take with nothing louder than the room goes straight back to Idle with "Didn't catch that. Try again." and nothing to save. On the web, its loudest 50 ms must reach -50 dBFS and stand at least 4 dB above the take's own room (its 10th-percentile 50 ms level), so short farts count. The iPhone app still turns away takes shorter than 0.5 s.
**NAVIGATION TYPE:** Tab.
**PATTERN CHOICE:** Recording fills the screen over the tabs, and Stop goes on to Review in the same full-screen cover. Apple's HIG says not to disable tab bar buttons; a modal may cover them.
**NOTES:** The owner asked for "just one big red button" (#47 review).

---

**SCREEN NAME:** Recordings
**PURPOSE:** See and play every Recording and the notes you've collected.
**HOW USER GETS HERE:** Tab 1 (Recordings), or Done after saving.
**WHAT'S ON THE SCREEN:**
- Large title "Recordings"
- The counts above the list: "9 Melodic Recordings across 7 notes" and "23 Recordings". Notes count with their octave, so G3 and G4 are two notes. Repeats matter because each Song pitch needs its own fart. (No pitch strip or piano roll here: the owner chose rows only in #72.)
- A list of Recordings, newest first. Each row has:
  - a big play button
  - the name ("Recording 7")
  - the note in a pill, with its octave ("G♯3"), or a quiet "noise-like" when the Recording has no steady pitch
  - a full-width waveform of just the fart replay plays (`replaySegment`), not the silence around it; the whole file until it's analyzed
  - "First fart used" when a second fart was cut off
**PRIMARY ACTION:** Play a Recording.
**SECONDARY ACTIONS:** Swipe to delete (with confirmation).
**STATES:**
- Empty ("No Recordings yet. Go to the Record tab and tap the red button.")
- Analyzing (a spinner under the name)
- Not analyzed (analysis failed; "not analyzed" with Retry under the name)
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
**HOW USER GETS HERE:** Tab 2 (Compose). In the MVP this is the whole tab.
**WHAT'S ON THE SCREEN:**
- (Post-MVP: a segmented control, Songs | AI, above the list)
- Search field
- Sort menu (Closest to unlocking | A–Z)
- **Unlocked** section: rows with the title and "Ready"
- **Locked** section: rows with the title, a progress bar ("3 of 5 notes covered"), a lock and the nearest missing note
- (Unlock rule: one different Melodic Recording per distinct pitch, within 3 semitones, or an octave away with an Octave Move where the Song needs it. See ADR 0006.)
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
- Piano roll fitted to the Song's range, with octave labels: notes you have filled, notes still needed dashed (ADR 0006)
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
**HOW USER GETS HERE:** Tab 2 (Compose), with the AI segment selected.
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

---

**SCREEN NAME:** Profile
**PURPOSE:** See what you've collected and made.
**HOW USER GETS HERE:** Tab 5 (Profile), on the far right.
**WHAT'S ON THE SCREEN:**
- Large title "Profile", on a stock `List`
- **Stats**, counted from what's on the phone:
  - Recordings
  - Melodic Recordings
  - Notes collected (distinct notes with their octave, as on the Recordings tab: G2 and G3 are two notes)
  - Songs unlocked ("6 of 12": Unlocked Songs, by Pitch Coverage)
  - Toots
- **About:**
  - Songs: "From public-domain scores in PDMX and the Mutopia Project"
  - Version ("0.1.0 (1)")
**PRIMARY ACTION:** None; it's for reading.
**SECONDARY ACTIONS:** None.
**STATES:**
- New user: every count is 0 ("0 of 12" Songs), with "Record your first fart on the Record tab. Collect notes to unlock Songs." under the stats
- Populated
**NAVIGATION TYPE:** Tab.
**NOTES:** Local only: no account or sign-in (ADR 0001). Added by the owner in the #57 tap-through (#60). Out of scope: the fart health analyzer (#24), gamification beyond these counts (#20) and settings.
