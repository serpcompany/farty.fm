# App map

Phase 1 of the SERP UI runbook. Approved by the owner in #47 (2026-09-29). Uses the vocabulary in `CONTEXT.md`.

## Main areas

Capture-first, as approved in #2, with the owner's changes from the #47 review: Record is its own tab and opens first, "Shelf" is renamed "Recordings", and "Create" is renamed "Compose".

| Tab | Name on screen | What it holds |
| --- | --- | --- |
| 1 | **Record** | One big red button. Tap to start, tap again to stop. Opens on launch. |
| 2 | **Recordings** | Every Recording, with its note, and the strip of collected notes |
| 3 | **Compose** | Song Creator (the Song Catalog with Pitch Coverage and unlocks) and AI Song Creator |
| 4 | **Melodies** | Created Melodies |
- **Debug builds only:** a "Load Fixture Library" action under a debug menu. It never appears in Release builds.

## Flows

- **First launch:** Launch → Welcome → Allow microphone → Record tab
- **Microphone denied:** Record → "Pedos needs the microphone" → Open Settings
- **Record a fart:** Record tab → tap the big button (it becomes Stop, with a timer) → tap again → Review (play back, Save / Discard) → Save → Analyzing → Result (Recording Pitch or "noise-like", plus any unlock progress) → Done → Recordings
- **Unlock moment:** Result → "You unlocked Twinkle, Twinkle" → Try it → Song Creator
- **Replay or delete a Recording:** Recordings → tap row to play → swipe or long-press → Delete → confirm
- **Make a Song:** Compose → Songs → an Unlocked Song → Song Creator (plays automatically) → Save → Melodies
- **See what a locked Song needs:** Compose → Songs → a locked Song → "Needs a fart near D3 and F3" sheet → Record (goes to the Record tab). Locked Songs can't be played.
- **Make an AI melody:** Compose → AI → pick a mood → Compose (plays) → Try again or Save → Melodies
- **Manage Created Melodies:** Melodies → tap to play → long-press → Rename or Delete

## Visual direction

Stock SwiftUI components from the latest iOS (Liquid Glass), with no custom component library. That means:
- `TabView` with `Tab`
- `NavigationStack` with large titles
- `List`
- `.searchable`
- a segmented `Picker`
- sheets with detents
- `confirmationDialog` and alerts
- `ProgressView`
- SF Symbols

Use system colors, with red only for recording. This is why the minimum iOS is 26 (ADR 0001). The prototype is a grayscale stand-in for structure only.

## Hierarchy and pattern notes

- **Tabs (root):** Record, Recordings, Compose, Melodies.
- **In-place switch:** Compose has a segmented control, Songs | AI. They are two ways to create, so they share one tab rather than two.
- **Pushed screen:** Song Creator is pushed from the Songs list.
- **In place:** recording happens on the Record tab itself; the other tabs are disabled while recording.
- **Full-screen cover:** Review → Result is one short task.
- **Sheets:**
  - Welcome / microphone explainer on first launch
  - a locked Song's "what's missing"
  - Rename
- **Alerts:** delete confirmations.
- **Toasts:** "Saved to Melodies".

## Decided in the #47 review

- **Layouts and flows:** approved by the owner on 2026-09-29. The real app builds them with stock SwiftUI and native iOS controls (see Visual direction). The HTML prototype is a structure reference only.

- **Tabs:** Record (one big red button, opens first), Recordings (renamed from Shelf), Compose (renamed from Create), Melodies.
- **Record flow and Recordings screen:** approved as prototyped.
- **Unlock rule:** a Song unlocks when each of its distinct pitches has its **own** Melodic Recording within 3 semitones: one different fart per pitch, and no fart stretched across the tune. A Pitch Coverage bar (a `ProgressView`) shows how many are covered ("3 of 4 notes covered"). With the 23 test farts, 6 of 12 Songs unlock once all 9 Melodic ones are collected. The first unlock comes at the 4th to 8th Melodic fart depending on order (the 6th in the prototype's order). Stars were dropped. #43 validates the rule, and decides whether ADR 0004's short-note limit is also part of unlocking.
- **Locked Songs can't be played.** There's no "Try anyway"; you unlock a Song to use it.
- **Native SwiftUI:** see Visual direction.

## Still open

1. **Early payoff:** the first unlock comes late. Proposed: add a few 3-note starter Songs (Hot Cross Buns and similar) through the batch import (#39), and let AI Song Creator work from 3 Melodic farts.
2. **Choosing Recordings:** Auto-map picks the farts itself, with no manual picking in the MVP.
3. **Naming Recordings:** default "Recording 1, 2, …", with no renaming in the MVP.
