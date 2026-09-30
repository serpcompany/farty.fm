# Screen inventory

Phase 2 of the SERP UI runbook. Approved by the owner in #47 (2026-09-29). The flows are in `app-map.md`, and the clickable version is in `prototype/`.

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
**HOW USER GETS HERE:** Tab 1 (Record). Opens on launch.
**WHAT'S ON THE SCREEN:**
- **Idle:** one big red button and nothing else
- **Recording:** the button turns into a Stop square with a pulse, and a timer appears
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
**PATTERN CHOICE:** Recording happens in place, not in a separate screen. The other tabs are disabled while recording.
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
**HOW USER GETS HERE:** Tab 3 (Compose), with the Songs segment selected.
**WHAT'S ON THE SCREEN:**
- Segmented control (Songs | AI)
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
**NAVIGATION TYPE:** Tab + in-place segment.

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
- The Recordings used, as small chips
- Save button
**PRIMARY ACTION:** Save.
**SECONDARY ACTIONS:** Play/Stop; tap a Recording chip to hear that fart alone.
**STATES:**
- Making ("Making your melody…", about 1–2 s)
- Ready (auto-plays once)
- Playing
- Saved (a toast: "Saved to Melodies")
- **Error:** couldn't make the melody, for example a Recording file is missing: "Couldn't make this melody", with Try again
**NAVIGATION TYPE:** Push.
**NOTES:** Not an editor. Nothing on this screen changes the Arrangement.

---

**SCREEN NAME:** Compose — AI
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

**SCREEN NAME:** Melodies
**PURPOSE:** Everything you've made.
**HOW USER GETS HERE:** Tab 4 (Melodies), or after Save.
**WHAT'S ON THE SCREEN:**
- Rows with a play button, title, origin ("Twinkle, Twinkle" or "AI · Happy"), date and length
**PRIMARY ACTION:** Play.
**SECONDARY ACTIONS:** Long-press for Rename or Delete (with confirmation).
**STATES:**
- Empty ("Nothing yet. Make one in Compose.")
- Populated
- Playing
- **Error:** audio missing or unreadable: "This melody's audio is missing", offering Delete
**NAVIGATION TYPE:** Tab.

---

**SCREEN NAME:** Rename
**PURPOSE:** Give a Created Melody a name.
**HOW USER GETS HERE:** Long-press a melody, then Rename.
**WHAT'S ON THE SCREEN:** A text field, Cancel and Save.
**NAVIGATION TYPE:** Alert with a text field.
**PLATFORM NOTE:** Apple default.
