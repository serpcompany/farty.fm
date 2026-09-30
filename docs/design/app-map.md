# App map

Phase 1 of the SERP UI runbook. Approved by the owner in #47 (2026-09-29). Uses the vocabulary in `CONTEXT.md`.

## Main areas

Capture-first, as approved in #2, with the owner's changes from the #47 review: Record is its own tab and opens first, "Shelf" is renamed "Recordings", and "Create" is renamed "Compose". Since #60, Record sits in the center of five tabs, and Profile is on the far right.

| Tab | Name on screen | What it holds |
| --- | --- | --- |
| 1 | **Recordings** | Every Recording, with its note, and the strip of collected notes |
| 2 | **Compose** | Song Creator: the Song Catalog with Pitch Coverage and unlocks. (AI Song Creator is post-MVP.) |
| 3 (center) | **Record** | One big red button. Tap to start: recording fills the screen, with Stop and a timer. Opens on launch, and again whenever the app comes back to the foreground (unless Review or Result is open). |
| 4 | **Toots** | Toots: Songs played by your Recordings, each with its own screen |
| 5 | **Profile** | Stats from what's on the phone (Recordings, Melodic Recordings, notes collected, Songs unlocked, Toots), where the Songs come from, and the app version. No account or sign-in (ADR 0001). |
- **Debug builds only:** a "Load Fixture Library" action under a debug menu. It never appears in Release builds.

## Flows

- **First launch:** Launch → Welcome → Allow microphone → Record tab
- **Microphone denied:** Record → "Pedos needs the microphone" → Open Settings
- **Record a fart:** Record tab → tap the big button (recording fills the screen: Stop, with a timer) → tap Stop → Review (play back, Save / Discard) → Save → Analyzing → Result (Recording Pitch or "noise-like", plus any unlock progress) → Done → Recordings
- **Unlock moment:** Result → "You unlocked Twinkle, Twinkle" → Try it → Song Creator
- **Replay or delete a Recording:** Recordings → tap row to play → swipe or long-press → Delete → confirm
- **Make a Toot:** Compose → Songs → an Unlocked Song → Song Creator (plays automatically) → Save → Toots
- **See what a locked Song needs:** Compose → Songs → a locked Song → "Needs a fart near D3 and F3" sheet → Record (goes to the Record tab). Locked Songs can't be played.
- **Make an AI melody (post-MVP):** Compose → AI → pick a mood → Compose (plays) → Try again or Save → Toots
- **Manage Toots:** Toots → tap a row's play button to play → or tap the row to open the Toot → Rename or Delete from its menu (or long-press the row)
- **Check the sound:** Song Creator or a Toot → tap a Recording to hear it alone and see its notes → tap a note to hear just that note as rendered
- **See your stats:** Profile → Recordings, Melodic Recordings, notes collected, Songs unlocked ("6 of 12") and Toots

## Visual direction

Stock SwiftUI components from the latest iOS (Liquid Glass), with no custom component library. That means:
- `TabView` with `Tab`
- `NavigationStack` with large titles
- `List`
- `.searchable`
- a segmented `Picker` (post-MVP, for Songs | AI)
- sheets with detents
- `confirmationDialog` and alerts
- `ProgressView`
- SF Symbols

Use system colors, with red only for recording. This is why the minimum iOS is 26 (ADR 0001). The prototype is a grayscale stand-in for structure only; its Songs | AI segment and AI melodies are post-MVP.

## Hierarchy and pattern notes

- **Tabs (root), left to right:** Recordings, Compose, Record (center), Toots, Profile. Record opens first.
- **In-place switch (post-MVP):** when AI Song Creator returns, Compose gets a segmented control, Songs | AI. They are two ways to create, so they share one tab rather than two. In the MVP, Compose is the Songs list only.
- **Pushed screens:** Song Creator is pushed from the Songs list, and a Toot's screen from the Toots tab.
- **Full-screen cover:** Recording → Review → Result is one short task, and it covers the tabs. (Apple's HIG says not to disable or hide tab bar buttons, and a modal may cover them.)
- **Sheets:**
  - Welcome / microphone explainer on first launch
  - a locked Song's "what's missing"
  - Rename
- **Alerts:** delete confirmations.
- **Saved:** the Save button turns into a disabled "Saved to Toots" (SwiftUI has no stock toast).

## Decided in the #47 review


- **Layouts and flows:** approved by the owner on 2026-09-29. The real app builds them with stock SwiftUI and native iOS controls (see Visual direction). The HTML prototype is a structure reference only.

- **Tabs:** Record (one big red button, opens first), Recordings (renamed from Shelf), Compose (renamed from Create), Melodies.
- **Record flow and Recordings screen:** approved as prototyped.
- **Unlock rule:** a Song unlocks when each of its distinct pitches has its **own** Melodic Recording within 3 semitones: one different fart per pitch, and no fart stretched across the tune. A Pitch Coverage bar (a `ProgressView`) shows how many are covered ("3 of 4 notes covered"). With the 23 test farts, 6 of 12 Songs unlock once all 9 Melodic ones are collected. The first unlock comes at the 4th to 8th Melodic fart depending on order (the 6th in the prototype's order). Stars were dropped. #43 validates the rule, and decides whether ADR 0004's short-note limit is also part of unlocking.
- **Locked Songs can't be played.** There's no "Try anyway"; you unlock a Song to use it.
- **Native SwiftUI:** see Visual direction.

## Decided after the #47 review

- **AI Song Creator is post-MVP** (owner in chat, 2026-09-29). The groundwork is kept on #21 and #22.

## Decided in the #52 tap-through (2026-09-30)

- **Toots:** the Melodies tab is now **Toots**, and a saved result is a Toot (`CONTEXT.md`).
- **Back to Record:** the app lands on the Record tab whenever it comes back to the foreground, unless Review or Result is open. Playback stops in the background.
- **Recording is full screen:** it covers the tabs instead of disabling them.
- **Recordings used** in Song Creator is a list: each Recording with the color of its notes, its name, waveform and length, the note it plays, and a play button.
- **A Toot's screen:** tapping a Toot opens Song Creator's layout without Save, with Rename and Delete in its menu. A Toot keeps which Recording played each pitch; one deleted later shows as "Recording deleted", and the Toot still plays.
- **Checking the sound:** tapping a Recording plays it alone and highlights its notes; tapping a note plays just that note from the Toot's own audio and says what it is ("F3 · Recording 21 (G3), shifted −2.1 semitones · 1.4 s").

## Decided in the #57 tap-through (2026-09-30)

- **Record in the center:** the tabs are Recordings · Compose · **Record** · Toots · Profile. Record's place is for thumb reach; Apple's HIG doesn't require it, and the owner chose it. The tab bar is the stock `TabView`, with no custom bar or raised button (#60).
- **Profile:** a new tab on the far right for the user's own data and stats, all local. In the MVP it's a stock `List` with the stats, a line crediting where the Songs come from (PDMX and the Mutopia Project), and the app version. Accounts, the fart health analyzer (#24), gamification beyond these counts (#20) and settings are out of scope.

## Still open

1. **Early payoff:** the first unlock comes late. Proposed: add a few 3-note starter Songs (Hot Cross Buns and similar) through the batch import (#39). Letting AI Song Creator work from 3 Melodic farts was the other idea; it's post-MVP with AI.
2. **Choosing Recordings:** Auto-map picks the farts itself, with no manual picking in the MVP.
3. **Naming Recordings:** default "Recording 1, 2, …", with no renaming in the MVP.
