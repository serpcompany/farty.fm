# Musical Fruit

`Musical Fruit` is the feature area for turning saved fart recordings into a later generated song or melody experience.

This folder is the parent spec for the feature area. Use it to understand the product call, rollout order, shared dependencies, and how the subfeatures fit together.

## Status

- Scope: `Phase Two`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

Musical Fruit is not part of the core recording MVP.

The core-app MVP should stay focused on recording, saving, playback, and account basics.

For Musical Fruit, the first step after MVP should be foundation work, not a public song-maker launch. That means sample-pack cleanup, clip analysis, melody-fit evaluation, and generation-contract planning come first. The public song-maker release should come only after that groundwork is proven.

## Product Call

The right plan is:

- keep core-app MVP free of Musical Fruit user flows
- do a post-MVP foundation pass before any public song-maker launch
- use reference melody templates instead of free-text song search in the first public release
- use a fart sampler driven by clip analysis, not generative music AI
- keep the first public release lightweight, not studio-like
- require async generation with visible job status once the public flow exists
- keep deterministic fart-only composition ahead of any third-party AI music generation

## Subfeatures

- [Clip Source Selection](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/clip-source-selection.md)
  - choose all clips, choose specific clips, or enter the AI-pick path
- [AI Smart Choose](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/ai-smart-choose.md)
  - let the app propose the best clips before generation
- [Original Song Generation](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/original-song-generation.md)
  - later public song-maker flow, after the feature foundation work is complete
- [MVP Plan](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/mvp-plan.md)
  - rollout plan for the post-MVP foundation pass and the later public song-maker release
- [API Comparison Spike](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/api-comparison-spike.md)
  - current issue `#1` comparison status, blockers, and final vendor-mismatch conclusion
- [Generated Song Management](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/generated-song-management.md)
  - rename, custom-name, or delete generated songs after creation
- [Generated Song Sharing](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/generated-song-sharing.md)
  - share a generated song using a direct link
- [Cover Song Concept](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/cover-song-concept.md)
  - typed artist / song concept path for later evaluation

## Planning Split

This folder is split by meaningful subfeature, not by every single control.

Use this rule:

- create a child doc when the flow can stand on its own
- keep lightweight controls inside the subfeature they belong to

For Musical Fruit, that means:

- `clip-source-selection.md` owns how source clips are chosen
- `ai-smart-choose.md` owns the assisted source-picking path
- `mvp-plan.md` owns the rollout call, including:
  - what does not belong in core-app MVP
  - what must be proven in the post-MVP foundation pass
  - what unlocks the later public song-maker release
- `original-song-generation.md` owns the later public song-maker submission step, including:
  - melody picker
  - optional simple style phrasing
  - visible `in progress` job state
- `generated-song-management.md` owns post-generation actions for saved results:
  - rename / custom name
  - delete
- `generated-song-sharing.md` owns sharing behavior for saved generated songs:
  - share action
  - direct song link
- `cover-song-concept.md` owns the later cover-style song path

## Shared User Value

The feature area should let the user:

- start from clips they already recorded in Pedos
- make something entertaining without needing music-production knowledge once the public generator exists
- understand what clips were used
- see submitted songs while they are still `in progress`
- come back later and play the result once it is ready

## Shared Release Scope

### Core App MVP

- no public Musical Fruit entry point
- no song-maker setup flow
- no generated-song list or playback

### First Post-MVP Foundation Pass

- sample-pack cleanup and manifest maintenance
- melody template catalog and metadata
- clip analysis and melody-fit scoring
- deterministic local render tool and worker contract
- generated-song data model and job-state planning
- internal listening and evaluation loop

### Later Public Release

- feature entry from saved clips
- clip source choice
- original-song generation
- generated song management
- lightweight creation options
- async job handling
- persistent visible `in progress` state
- result playback

### Later After Public Release

- generated song sharing by link
- cover-style song concept flow
- typed artist or song name input
- richer post-generation editing
- multiple result variants per run

### Explicitly Not The First Public Release

- full DAW-like editing
- live generation while recording
- instant sub-second generation promises
- custom wake-word behavior
- background passive listening tied to song creation

## Shared UX Requirements

- the feature should feel like an optional creative payoff layer, not a core dependency for the app
- the user must always understand what source clips are being used
- the creative controls should stay lightweight
- a submitted song must remain visible somewhere in the feature until it finishes or fails
- failed jobs must remain visible long enough for the user to understand what happened and retry

## Shared Dependencies

### Product Dependencies

- stable saved clip history
- reliable playback
- generated-song destination screens or list states

### Service Dependencies

- orchestration layer for clip selection and prompt shaping
- deterministic local composition engine
- generated-song storage
- background jobs or queue
- audio preprocessing as needed

- [Services](../../../../../apps/.archive/docs/plan/features/services/README.md)

## Service Strategy

Recommended orchestration layer:

- local composition pipeline plus lightweight clip analysis

Recommended first engine to test:

- deterministic reference-melody fart sampler

Recommended comparison order:

1. local reference-melody fart sampler
2. melody-eval scoring tool
3. optional later non-MVP remix mode evaluation

Related issue:

- [#1](https://github.com/serpcompany/pedos-app/issues/1)

Related planning docs:

- [API Comparison Spike](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/api-comparison-spike.md)
- [MVP Plan](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/mvp-plan.md)

## Sample Pack For Testing

Use the current shared fart-sample pack when comparing services:

- [sample pack README](../../../../../apps/.archive/docs/test-data/pedos-ai/fart-samples/README.md)
- [sample manifest JSON](../../../../../apps/.archive/docs/test-data/pedos-ai/fart-samples/freesound-cc0/manifest.json)
- [sample manifest CSV](../../../../../apps/.archive/docs/test-data/pedos-ai/fart-samples/freesound-cc0/manifest.csv)
- [sample-pack generator](../../../../../apps/.archive/docs/scripts/pedos-ai/generate-sample-pack.mjs)

Related issues:

- [#2](https://github.com/serpcompany/pedos-app/issues/2)
- [#3](https://github.com/serpcompany/pedos-app/issues/3)

## Related Docs

- [UI Screens](../../../../../apps/.archive/docs/plan/features/ui/screens.md)
- [Features](../../../../../apps/.archive/docs/plan/features/musical-fruit/README.md)
