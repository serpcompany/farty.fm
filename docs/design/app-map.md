# App map

Phase 1 of the SERP UI runbook. Draft for owner review in #47. Uses the vocabulary in `CONTEXT.md`.

## Main areas

The approved Capture Dock (#2): a tab bar with three peer areas, and recording one tap away from all of them.

| Tab | Name on screen | What it holds |
| --- | --- | --- |
| 1 | **Shelf** | The Recording shelf, collected pitches, and the big Record button |
| 2 | **Create** | Song Creator (the Song Catalog with Pitch Coverage and unlocks) and AI Song Creator |
| 3 | **Melodies** | Created Melodies |

- **Record** is a red button in the top-right of every tab, plus the big button at the top of the Shelf.
- **Debug builds only:** a "Load Fixture Library" action under a debug menu. It never appears in Release builds.

## Flows

- **First launch:** Launch → Welcome → Allow microphone → Shelf (empty)
- **Microphone denied:** Record → "Pedos needs the microphone" → Open Settings
- **Record a fart:** any tab → Record → Recording (live level, timer) → Stop → Review (play back, Save / Discard) → Save → Analyzing → Result (Recording Pitch or "noise-like", plus any unlock progress) → Done → Shelf
- **Unlock moment:** Result → "You unlocked Twinkle, Twinkle" → Try it → Song Creator
- **Replay or delete a Recording:** Shelf → tap row to play → swipe or long-press → Delete → confirm
- **Make a Song:** Create → Songs → an Unlocked Song → Song Creator (plays automatically) → Save → Melodies
- **See what a locked Song needs:** Create → Songs → a locked Song → "Needs a fart near D3 and F3" sheet → Record
- **Make an AI melody:** Create → AI → pick a mood → Compose (plays) → Try again or Save → Melodies
- **Manage Created Melodies:** Melodies → tap to play → long-press → Rename or Delete

## Hierarchy and pattern notes

- **Tabs (root):** Shelf, Create, Melodies.
- **In-place switch:** Create has a segmented control, Songs | AI. They are two ways to create, so they share one tab rather than two.
- **Pushed screen:** Song Creator is pushed from the Songs list.
- **Full-screen cover:** Recording → Review → Result is one short task and must not be dismissed by accident mid-recording.
- **Sheets:**
  - Welcome / microphone explainer on first launch
  - a locked Song's "what's missing"
  - Rename
- **Alerts:** delete confirmations.
- **Toasts:** "Saved to Melodies".

## Open questions for the owner

1. **Locked Songs:** can a locked Song be played at all? Proposed: not from the list; the "what's missing" sheet has a small "Try anyway" that warns it may sound off.
2. **Choosing Recordings:** earlier plans let users pick which Recordings a melody uses. Auto-map now picks the best ones on its own. Proposed: no manual picking in the MVP.
3. **Naming Recordings:** Recordings are named "Recording 1, 2, …" by default. Should users be able to rename them? Proposed: not in the MVP.
4. **Unlock rule** (feeds #43): the 9 Melodic fixture farts sit at a few pitches: E2, F♯2, C3, G3, G♯3 (three of them), B3 and G4. So a rule of the form "every needed note within N semitones" either never unlocks anything (N = 1–2) or unlocks nearly everything after 2–4 farts (N = 3). The prototype's proposal:
   - **Unlocked** once every note can be reached within 5 semitones, which the engine plays well.
   - **1–3 stars** by how many notes have a fart within 1 semitone ("3 of 5 notes matched"). ★★★ is the long-term chase.
   - With the fixture order in the prototype: the first Melodic fart unlocks 6 Songs, the second unlocks all 12, and later farts upgrade stars.

