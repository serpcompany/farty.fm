# Quick Record

Start recording as fast as possible from Siri or from anywhere inside the app.

## Status

- Scope: `MVP`
- Status: `Draft`
- Owner: `TBD`
- App area: `Core Capture`
- Access: `Account`

## Summary

Quick Record is the fast-entry recording feature for Pedos. It gives the user three ways to begin a recording without hunting through screens: a Siri phrase, an optional auto-record-on-foreground setting, and a floating record button that stays available above the bottom navigation.

The goal is to remove friction from the core product loop. If someone wants to capture something immediately, the app should feel ready before they have time to second-guess it.

## Target User And Moment

This feature is for users who want to capture a fart recording quickly and do not want to navigate through the app first.

Common moments:

- the user wants to start recording hands-free or nearly hands-free
- the user opens Pedos with the expectation that it should record immediately
- the user is already inside the app and wants a record control that is always easy to reach

## Problem It Solves

The main product value breaks down if starting a recording feels slow. Without a fast-entry path, the user has to open the app, find the right screen, and then tap the right button, which increases the chance that they miss the moment or feel the app is annoying to use.

Quick Record solves that by making recording available from outside the app and from every major in-app area.

## User Stories

- As a user, I can say `Hey Siri, record with Pedos` and get into recording immediately.
- As a user, I can enable a setting so Pedos starts recording when the app becomes active.
- As a user, I can tap a floating record button from anywhere in the main app and start recording right away.
- As a user, I can tap the same floating record button again to stop the recording.
- As a user, I can clearly tell when recording has started, is active, and has stopped.

## Release Scope

### In Scope

- Siri / App Shortcut path using `Record with Pedos`
- in-app setting that auto-starts recording when Pedos becomes active in the foreground
- floating record button above the bottom nav on the main app screens
- permission handling and failure recovery for all quick-record entry points
- clear recording-state feedback so the user knows recording is live

### Out Of Scope

- custom wake word such as `Hey Pedos`
- passive background listening
- starting a recording while the app remains in the background with no user-triggered open or foreground event
- lock-screen-only custom recording UX outside what Siri / Shortcuts naturally support

### Future Expansion

- Action Button support if not included in the first implementation
- Home Screen widget shortcut
- configurable behavior such as auto-open review screen vs keep recording screen active

## Product Recommendation

All three entry paths should exist, but they serve different moments:

- `Hey Siri, record with Pedos`
  - best system-level quick-record path
  - best option when the user is not already inside the app
- `Auto-start recording when app becomes active`
  - best power-user option
  - should be a setting and should default to off
- `Floating record button`
  - best everyday in-app control
  - should be visible from all main app screens

If the team has to prioritize implementation order, the best sequence is:

1. floating record button
2. Siri / App Shortcut
3. auto-start-on-foreground setting

If the question is which path is the cleanest official quick-record solution, it is Siri / App Shortcuts.

## Primary UX Flow

### Happy Path A: Siri / App Shortcut

1. User says `Hey Siri, record with Pedos`.
2. Siri runs the Pedos App Shortcut / App Intent.
3. Pedos opens directly into the recording flow.
4. If microphone permission is already granted, recording starts immediately.
5. The app shows a strong active-recording state with an obvious stop action.
6. User stops the recording and continues into review / save.

### Happy Path B: Auto-Start On App Open / Foreground

1. User enables `Auto-start recording when Pedos becomes active` in Settings.
2. Later, the user opens Pedos or switches back to Pedos from another app.
3. When Pedos becomes the active foreground app, it starts recording immediately if permission already exists.
4. The user sees the active-recording state right away.
5. The user stops the recording and continues into review / save.

### Happy Path C: Floating Record Button

1. User is on any supported main app screen.
2. User taps the floating record button above the bottom nav.
3. Recording starts immediately.
4. The floating control switches into a clear stop state.
5. User taps it again to stop.
6. The app routes into review / save.

### Empty-State Path

1. User enters the app with no saved recordings yet.
2. The floating record button is still present and usable.
3. The first successful quick recording creates the first item in history and unlocks the rest of the loop.

### Error / Failure Path

1. User tries any quick-record entry point without microphone permission.
2. The app does not fake success.
3. The app shows a permission-required fallback that explains why recording did not start.
4. The user can open system settings or retry after granting permission.

### Alternate Paths

- If the app is already actively recording and the user foregrounds the app again, the recording should continue rather than restart.
- If the user taps the floating record button while already recording, the same control stops the recording.
- If Siri launches Pedos and recording fails, the app should land in a clear failure state with retry guidance.

## Screen Responsibilities

- `Settings`
  - holds the auto-start-on-foreground toggle
  - explains what happens when the setting is enabled
- `Siri / App Shortcut Quick Record Entry`
  - handles shortcut launch and route into recording
  - handles permission and launch failures
- `Main App Screens`
  - show the floating record button above the bottom nav
  - allow the user to start recording from anywhere important
- `Recording`
  - shows active recording state
  - provides clear stop control and timer feedback
- `Permission Fallback`
  - explains why recording did not start
  - gives the user a path to fix it
- `Review / Save`
  - lets the user preview, save, or discard the clip after stopping

- [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md)

## UX Requirements

- the user must always know whether recording is live
- the floating record button must remain easy to reach and visually stable across supported screens
- the auto-start setting must default to off
- the first time the user enables auto-start, the app should explain that recording begins when Pedos becomes active
- Siri quick record should feel immediate and should not dump the user on a generic home screen first
- the app must never pretend recording started when permission or session setup failed
- stop behavior should feel consistent across all three entry paths

## Functional Requirements

- the app must support a Siri / App Shortcut phrase centered on `Record with Pedos`
- the app must open directly into the recording flow when started from the Siri shortcut
- if microphone permission already exists, the Siri path must start recording immediately
- the app must provide a Settings toggle for auto-starting recording when Pedos becomes the active foreground app
- when that setting is enabled, opening Pedos or switching back to Pedos should start recording automatically if permission already exists
- the app must provide a floating record button above the bottom nav on the main in-app screens
- the floating record button must toggle between start and stop behavior
- after stop, the app must route the user into review / save
- if microphone permission is missing, the app must show a clear fallback path instead of silently failing

## Inputs And Outputs

### Inputs

- Siri voice phrase or App Shortcut invocation
- app foreground / active lifecycle event when auto-start is enabled
- user tap on the floating record button
- microphone permission state

### Output

- active recording session
- stopped recording ready for review
- permission fallback if recording cannot begin

## Dependencies

### Product Dependencies

- recording screen and recording-state UI
- review / save flow
- settings screen
- permission education / fallback flow

### Technical / Service Dependencies

- Apple App Intents / App Shortcuts / Siri
- Apple audio frameworks
- app lifecycle handling for foreground activation
- recording state management so quick entry paths do not conflict

- [Services](../../../apps/.archive/docs/plan/services/README.md)

## Data / Tracking

- quick record started
- quick record source: `siri`, `auto_start`, or `floating_button`
- quick record failed
- failure reason: permission missing, audio session failed, launch failed, unknown
- recording completed after quick-start
- auto-start setting enabled or disabled

## Acceptance Criteria

- [ ] user can say `Hey Siri, record with Pedos` and land in the recording flow
- [ ] Siri quick record starts recording immediately when permission is already granted
- [ ] the app shows a permission fallback when Siri quick record cannot start
- [ ] user can enable a setting that starts recording when Pedos becomes active in the foreground
- [ ] with that setting enabled, opening Pedos or switching back to it starts recording automatically
- [ ] user can start recording from a floating record button above the bottom nav
- [ ] user can stop the recording from the same floating control
- [ ] after stop, the app routes to review / save
- [ ] the app clearly communicates active recording state for all three entry paths

## Critical QA Scenarios

- first-time Siri quick-record flow with microphone permission already granted
- Siri quick-record flow when microphone permission has not been granted
- first-time enablement of the auto-start setting
- app cold open with auto-start enabled
- app foreground return from another app with auto-start enabled
- app foreground return while a recording is already active
- floating record button start / stop on each supported main app screen
- audio session setup failure during quick record
- successful route into review / save after quick-record stop

## Success Criteria

- users can start recording in a way that feels immediate from outside or inside the app
- users understand the difference between idle and active recording states
- quick-record failures are understandable and recoverable
- the feature reduces friction enough that recording feels like the natural first action in Pedos

## Risks

- auto-start-on-foreground can feel surprising if it is enabled accidentally
- a floating button can collide with other important screen actions if the layout is not disciplined
- Siri behavior may feel inconsistent if shortcut phrasing, launch time, or permission fallback is weak

## Open Decisions

- whether the floating record button appears on every logged-in screen or only the primary tab screens
- whether quick record should route to a dedicated recording screen immediately or keep the user in-place with an overlay experience
- whether auto-start should be suppressed in any screens or states, such as during onboarding or while a modal is open
