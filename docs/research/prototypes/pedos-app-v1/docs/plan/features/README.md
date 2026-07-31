# Features

This is the master feature inventory for the app.

Use this doc to see:

- what features exist
- which app area they belong to
- whether they are `MVP`, `V1`, `Phase Two`, or `Later`
- which planning phase they are currently in
- where the deeper planning lives

Use the GitHub Project board for workflow and issue status, not this doc.

## Template

Use this when creating a new feature spec:

- [Feature Spec Template](../../../apps/.archive/docs/plan/features/_template.md)
- [Future Features](../../../apps/.archive/docs/plan/features/future-features.md)

## Working Rule

- each row should represent a feature or feature group, not every tiny UI detail
- keep row names stable even if the implementation shifts
- link outward to deeper docs, issues, and wireframes instead of stuffing full specs into the table
- use `Scope` for release intent and `Phase` for planning maturity
- use `Access` for guest/account/gated behavior
- only put a real link in `Wireframe` when the current screen inventory or prototype actually covers it

## Feature Inventory

| Feature | App Area | Scope | Phase | Access | User Job | Plan Doc | Issue | Wireframe | Dependencies |
|---|---|---|---|---|---|---|---|---|---|
| One-Tap Record Entry | Core Capture | MVP | UX/IA | Account | Start recording in one tap from inside the app | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | permission state, recording state |
| Manual Recording Session | Core Capture | MVP | Definition | Account | Record a fart clip and stop it cleanly | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | Apple audio frameworks |
| Review Before Save | Core Capture | MVP | Definition | Account | Preview a clip, then save or discard it | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | temporary clip storage, metadata model |
| Saved Recording History | Library & Playback | MVP | Definition | Account | Browse past fart clips in time order | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | audio storage, metadata database |
| Recording Playback | Library & Playback | MVP | UX/IA | Account | Replay a saved clip reliably | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | playback APIs, saved clip metadata |
| Delete Recording | Library & Playback | MVP | Definition | Account | Remove a bad or unwanted recording | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | storage delete flow, metadata delete |
| Quick Record | Core Capture | MVP | Definition | Account | Start recording fast from Siri or anywhere in the app | [Quick Record](../../../apps/.archive/docs/plan/features/quick-record.md) | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | App Intents, App Shortcuts, Siri, app lifecycle, recording state |
| Stats Dashboard | Analytics | MVP | Definition | Account | See total count, total duration, and recent activity | TBD | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | metadata aggregations |
| Calendar / Heatmap View | Analytics | V1 | Definition | Account | Review fart activity by day or trend pattern | TBD | TBD | TBD | stats model, calendar UI |
| Musical Fruit / AI Song Creator | Musical Fruit | Phase Two | Definition | Account | Support a later song-creation expansion after the core app MVP | [Musical Fruit](../../../apps/.archive/docs/plan/features/musical-fruit/README.md) | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | eligible clip inventory, saved clip library, generated file storage |
| Clip Source Selection | Musical Fruit | Later | Definition | Account | Choose all clips or specific clips once the public Song Maker flow ships | [Clip Source Selection](../../../apps/.archive/docs/plan/features/musical-fruit/clip-source-selection.md) | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | saved clip library |
| AI Smart Choose | Musical Fruit | Later | Service Spike | Account | Let the app choose the best clips once the public Song Maker flow ships | [AI Smart Choose](../../../apps/.archive/docs/plan/features/musical-fruit/ai-smart-choose.md) | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | orchestration layer, clip metadata |
| Original Song Generation | Musical Fruit | Later | Definition | Account | Turn saved fart clips into an original song after Musical Fruit foundation work is complete | [Original Song Generation](../../../apps/.archive/docs/plan/features/musical-fruit/original-song-generation.md) | [#1](https://github.com/serpcompany/pedos-app/issues/1) | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | deterministic local composition engine, background jobs, generated file storage |
| Generated Song Management | Musical Fruit | Later | Definition | Account | Rename, custom-name, or delete a generated song after the public Song Maker flow ships | [Generated Song Management](../../../apps/.archive/docs/plan/features/musical-fruit/generated-song-management.md) | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | generated song metadata, delete flow |
| Generated Song Sharing | Musical Fruit | Later | Definition | Account | Share a generated song using a direct song link | [Generated Song Sharing](../../../apps/.archive/docs/plan/features/musical-fruit/generated-song-sharing.md) | TBD | [UI Screens](../../../apps/.archive/docs/plan/ui/screens.md) | generated song storage, link generation |

## Next Cleanup Pass

- replace `TBD` issue links as feature planning is split into more GitHub issues
- add more specific wireframe links once the screen-to-feature mapping is stable
