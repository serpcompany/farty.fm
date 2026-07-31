# UI Screens

This doc is the master screen inventory for the app.

Use it to answer:

- what full screens the app needs
- what important state screens or modal surfaces still need design
- what belongs to `MVP`, `Phase Two`, or `Later`

## Scope Rules

- list a row if the user can land on it directly
- list a row if it changes the flow enough that it needs wireframes or QA coverage
- keep future and non-MVP surfaces in this doc, but mark them clearly

## Navigation Model

- Current MVP tabs
  - Home
  - Profile / Settings
- Current MVP shared control
  - floating record button above the bottom nav
- Current MVP internal destinations from profile area
  - History
- Phase Two nav addition
  - AI Song Creator / Musical Fruit entry
- Later nav additions
  - Stats from the profile area
  - Friends / social surfaces

## MVP Screens

### Entry And Permissions

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| App launch / session restore | State surface | MVP | decide whether the user lands in auth or the app | loading state while auth/session is resolved |
| Welcome / Sign In | Screen | MVP | get the user into the app | current plan assumes account-based entry |
| Auth error | State surface | MVP | recover from sign-in failure | should route back into sign-in cleanly |
| Microphone permission education | Screen | MVP | explain microphone access before the system prompt | should make the permission ask feel justified |
| Microphone permission denied | Screen | MVP | recover when mic access is blocked | must include path to Settings |
| iOS microphone permission prompt | System surface | MVP | OS-owned permission prompt | not app-designed, but must be mapped in the flow |

### Core Capture

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| Home | Screen | MVP | main landing screen and fastest in-app route into recording | should include floating record control, recent recordings, and lightweight snapshot info |
| Recording | Screen | MVP | show an active live recording session | must make recording state unmistakable |
| Recording failed | State surface | MVP | recover if the audio session cannot start or continue | can be a dedicated state or a clear failure takeover |
| Review Before Save | Screen | MVP | preview, save, or discard a new recording | optional note / intensity inputs can live here if they ship |
| Save failed | Modal or state surface | MVP | recover when saving the recording fails | should preserve context and allow retry |
| Siri / App Shortcut quick-record launch | Launch route | MVP | bring the user directly into recording from Siri / App Shortcuts | phrase direction is `Record with Pedos` |
| Quick-record permission fallback | State surface | MVP | explain why quick record did not start | used when Siri or auto-start cannot begin recording |

### Library And Playback

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| History | Screen | MVP | browse saved recordings | should support empty, loading, and populated states; accessed from the profile area, not the bottom nav |
| Recording detail / playback | Screen | MVP provisional | open one saved recording in a cleaner playback view | keep this in the inventory until inline-only playback is an intentional decision |
| Delete recording confirmation | Modal | MVP | confirm destructive recording delete | should be reachable from history and detail playback |
| Playback failure | State surface | MVP | explain playback problems and allow retry | can appear from history inline playback or the detail screen |

### Profile And Settings

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| Profile / Settings | Screen | MVP | act as the account area and internal route hub | should include links into History and other profile-area destinations |
| Auto-record explanation | Modal or inline state | MVP | explain what happens when auto-start-on-foreground is enabled | should appear the first time the setting is enabled |
| Sign out confirmation | Modal | MVP | confirm sign-out | keep lightweight |
| Delete account confirmation | Modal | MVP | confirm destructive account removal | can stay minimal in MVP |

## Shared MVP Surfaces

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| Bottom navigation | Shared UI | MVP | move between the main app areas | current MVP direction is Home plus Profile / Settings; History does not live here |
| Floating record button | Shared UI | MVP | start or stop recording from major in-app screens | must stay visually stable across supported screens |
| Generic loading / syncing | Shared UI | MVP | cover save, fetch, and session loading moments | keep visually consistent |
| Generic retry / recoverable error pattern | Shared UI | MVP | handle non-destructive failures cleanly | useful for permission, playback, save, and load failures |

## Phase Two Screens

No public Musical Fruit screens should ship in the first post-MVP foundation pass. That phase should stay focused on internal tooling, evaluation, and contracts rather than user-facing song-maker surfaces.

## Later Screens

### Musical Fruit Public Release

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| AI Song Creator home / song list | Screen | Later | entry screen for Musical Fruit and home for generated songs | must show empty state, ready songs, failed songs, and visible `in progress` items |
| Clip Source Selection | Screen | Later | choose all clips, specific clips, or AI Smart Choose | should make selected-count feedback obvious |
| AI Smart Choose review | Screen | Later | review the app-proposed clip set before continuing | user must be able to accept or revise |
| Song type selection | Screen | Later | choose the public song-maker path vs cover-style path | song-maker should not appear until the Musical Fruit foundation work is done |
| Original song setup | Screen | Later | collect melody source and optional style choices | should stay lightweight, not studio-like |
| Generation in progress | Screen or state surface | Later | show the active generation job after submission | user can leave this screen, but the job must remain visible elsewhere |
| Generation failed | State surface | Later | explain a failed generation and allow retry | failed jobs should stay visible |
| Generated song result | Screen | Later | play the generated song and manage it | should show source context and the current title |
| Rename generated song | Modal | Later | rename or custom-name a generated song | should feel quick and lightweight |
| Delete generated song confirmation | Modal | Later | confirm destructive generated-song delete | should not lose context |

### Musical Fruit Later Additions

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| Cover song setup | Screen | Later | accept artist name, song name, or both for a cover-style concept | routes into the normal generation flow after input |
| Share generated song | System share flow or modal | Later | share a generated song by link | should avoid exposing raw storage URLs |

### Future Product Surfaces

| Screen / Surface | Type | Scope | Purpose | Notes |
|---|---|---|---|---|
| Stats dashboard | Screen | Later | show recording payoff and personal activity summary | accessed from the profile area, not the bottom nav |
| Calendar / heatmap | Screen | Later | show recording activity by day or trend | expansion of stats, not MVP |
| Friends list | Screen | Later | show current friends and social connections | required if the app adds friend relationships |
| Add friends / search | Screen | Later | find and add other users | likely includes friend request or invite actions |
| Friend requests / invites | Screen or modal | Later | accept, reject, or manage friend requests | needed if friend flow is approval-based |
| Share recording to friend | Screen or modal | Later | send a fart recording to one or more friends | depends on in-app sharing permissions |
| Shared recordings inbox / shared with me | Screen | Later | show recordings received from friends | recipient needs a place to find shared clips |
| Song collab setup | Screen | Later | start a collab song flow using your clips and a friend's clips | depends on cross-user permissions and clip selection rules |
| Collaborator picker | Screen or modal | Later | choose which friend to collaborate with | likely part of the collab setup flow |
| Social profile | Screen | Later | show your own profile and fart posts | lightweight social profile with posts, likes, comments, and votes |
| Other user profile | Screen | Later | view another user's profile and posts | needed if profiles become social destinations |
| Post detail / comments | Screen | Later | open one social fart post and view comments or votes | supports deeper engagement than the profile grid/list alone |

## Related Docs

- [Features](../../../apps/.archive/docs/plan/features/README.md)
- [Quick Record](../../../apps/.archive/docs/plan/features/quick-record.md)
- [Musical Fruit](../../../apps/.archive/docs/plan/features/musical-fruit/README.md)
- [Future Features](../../../apps/.archive/docs/plan/features/future-features.md)
- [UI Sections](../../../apps/.archive/docs/plan/ui/sections.md)
- [Services](../../../apps/.archive/docs/plan/services/README.md)
