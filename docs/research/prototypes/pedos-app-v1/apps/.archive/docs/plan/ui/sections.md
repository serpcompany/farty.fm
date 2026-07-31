# UI Sections

This doc tracks reusable screen sections and shared layout blocks.

Use it for:

- pieces that appear inside one or more screens
- shared navigation and shared content blocks
- planning what should become a reusable component later

## Rules

- a `screen` is a full destination the user lands on
- a `section` is a meaningful chunk inside a screen
- a `shared UI` item is a reusable control or pattern used across multiple screens

## Shared Navigation And Layout

| Section / Shared UI | Used In | Scope | Purpose | Notes |
|---|---|---|---|---|
| Bottom navigation | Home, Profile / Settings, later AI Song Creator | MVP | move between the main app destinations | current bottom-bar direction is `Home` and `Profile / Settings`; `History` and `Stats` do not live here, and AI Song Creator should not appear until the later public Song Maker release |
| Floating record button | Home, Profile / Settings, History, other major logged-in screens | MVP | start or stop recording from anywhere important | should sit above the bottom nav and stay visually stable |
| Top app bar / screen header | most full screens | MVP | orient the user and hold the title / back action | can vary, but should feel consistent |

## Entry And Permissions

| Section / Shared UI | Used In | Scope | Purpose | Notes |
|---|---|---|---|---|
| Welcome hero / auth CTA block | Welcome / Sign In | MVP | explain the app quickly and route into auth | product name, value prop, auth CTA |
| Permission explainer block | Microphone permission education | MVP | explain why mic access is needed | should reduce hesitation before the system prompt |
| Permission recovery block | Microphone permission denied, quick-record fallback | MVP | explain how to recover from blocked mic access | should include Settings path |

## Core Capture

| Section / Shared UI | Used In | Scope | Purpose | Notes |
|---|---|---|---|---|
| Home quick-record section | Home | MVP | give the fastest in-app route into recording | should feel like the primary job of the app |
| Recent recordings section | Home, Profile / Settings | MVP | show the latest saved clips or a summary of them | can be a preview rather than full history |
| Active recording status section | Recording | MVP | make it obvious the app is live-recording | timer, live state, stop action |
| Review playback section | Review Before Save | MVP | preview the just-recorded clip | playback, timestamp, duration |
| Save action section | Review Before Save | MVP | let the user save or discard | can include optional note / intensity fields |

## Library And Profile Area

| Section / Shared UI | Used In | Scope | Purpose | Notes |
|---|---|---|---|---|
| Profile summary section | Profile / Settings | MVP | orient the user inside the account area | can show account identity and app status |
| Profile navigation section | Profile / Settings | MVP | route to `History`, later `Stats`, and settings actions | this is the main place where `History` and `Stats` should be linked |
| Quick-record settings section | Profile / Settings | MVP | manage quick-record-related toggles and explanations | includes auto-record-on-foreground behavior |
| Recording list section | History | MVP | render saved recordings in chronological order | supports empty, loading, and populated states |
| Recording list item | Home preview, History | MVP | show one saved recording row | timestamp, duration, quick playback, open action |
| Playback detail section | Recording detail / playback | MVP provisional | focus on one saved recording | can be dropped if inline playback wins |

## Musical Fruit / AI Song Creator

| Section / Shared UI | Used In | Scope | Purpose | Notes |
|---|---|---|---|---|
| Generated songs list section | AI Song Creator home / song list | Later | show ready, failed, and in-progress songs | should make pending jobs easy to find later |
| Pending song item | AI Song Creator home / song list | Later | show a submitted song while it is still processing | must not disappear if the user leaves the loading screen |
| Source mode picker | Clip Source Selection | Later | choose all clips, manual clips, or AI Smart Choose | should keep the step lightweight |
| Manual clip picker section | Clip Source Selection | Later | choose specific recordings for song generation | selected-count feedback should stay obvious |
| AI proposal review section | AI Smart Choose review | Later | show the suggested clip set before continuing | user must be able to revise |
| Song options section | Original song setup | Later | collect melody source and optional style choices | should stay simple, not studio-like |
| Job status section | Generation in progress, generation failed | Later | show current generation state clearly | should support retry and return-later behavior |
| Generated song actions section | Generated song result | Later | hold play, rename, delete, and later share actions | should show current title and source context |

## Future Social Sections

| Section / Shared UI | Used In | Scope | Purpose | Notes |
|---|---|---|---|---|
| Friends list section | Friends list | Later | show current friends and friend states | needed if social graph ships |
| Friend request section | Add friends / search, friend requests | Later | manage pending friend actions | accept, reject, or cancel |
| Shared recordings section | Shared with me, profile | Later | show recordings shared by friends | separate from the user's own history |
| Collaboration source section | Song collab setup | Later | show which of your clips and your friend's clips are included | depends on multi-user permissions |
| Profile posts grid / feed | Social profile, other user profile | Later | show fart posts and social activity | likes, comments, votes, and identity context |
