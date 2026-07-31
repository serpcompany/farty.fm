# Original Song Generation

Turn selected fart clips into an original generated song.

## Status

- Scope: `Later`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

Original Song Generation is the later public song-maker flow inside Musical Fruit.

It is not part of the core-app MVP, and it is not the first Musical Fruit milestone after MVP.

The first Musical Fruit milestone after MVP should be foundation work: sample-pack cleanup, clip analysis, melody-fit evaluation, and generation-contract planning.

This public flow should come after that groundwork is proven.

When it does launch, it should use a deterministic fart-only composition engine, not a third-party music-generation API.

This doc intentionally includes the setup options that belong to this later public flow:

- melody source
- optional simple style preset
- arrangement derived only from the selected fart clips

## Target User And Moment

This feature is for users who already have a chosen clip set and want Pedos to turn it into something surprising and entertaining without making them learn music-production tools.

## User Stories

- As a user, I can generate an original song from my selected clips once Musical Fruit launches publicly.
- As a user, I can choose a built-in melody source.
- As a user, I can optionally choose a simple style preset.
- As a user, I can submit the request without a complex studio workflow.
- As a user, I can see my submitted song as `in progress` until it finishes or fails.
- As a user, I can come back later and open the finished result.

## Release Scope

### In Scope

- original-song mode as a later public release
- built-in melody source chooser
- optional simple style preset
- deterministic fart-only arrangement engine
- async generation job
- persistent visible `in progress` song state
- failed state that stays visible
- generated result playback

### Out Of Scope

- cover-style concept flow
- advanced multi-track editing
- multiple variants per single run
- instant generation promises

### Future Expansion

- richer style controls
- post-generation editing
- multiple variants
- sharing or export

## Primary UX Flow

### Happy Path

1. User enters Original Song Generation with a chosen source set.
2. User chooses a built-in melody source.
3. User optionally chooses a simple style preset.
4. User submits the generation request.
5. App creates a visible pending song item with an `in progress` state.
6. App shows an in-progress screen, but the user is free to leave it.
7. If the user leaves, the pending item remains visible somewhere obvious in the feature.
8. When the job completes, the pending item updates to a ready result state.
9. User opens the result and plays the song.

### Error / Failure Path

1. The job fails or times out.
2. The pending song item updates from `in progress` to `failed`.
3. App shows a clear failure state.
4. User can retry, revise the settings, or leave and return later.

## Screen Responsibilities

- `Original Song Setup`
  - collects melody source
  - collects optional style preset
- `Generation In Progress`
  - shows active job status
- `Pending Song Item`
  - persists after submission
  - shows `in progress`, `failed`, or ready state
  - gives the user a path back into the result or retry flow
- `Generated Song Result`
  - playback and source summary

- [UI Screens](../../../../../apps/.archive/docs/plan/features/ui/screens.md)

## UX Requirements

- the creation step must stay lightweight
- melody source selection should be simple and recognizable
- style should stay optional
- a submitted song must remain visible until it finishes or fails
- an `in progress` song must not disappear just because the user leaves the loading screen
- failed jobs should remain visible long enough for the user to understand what happened and retry

## Functional Requirements

- the feature must support original-song generation from a selected source set
- the feature must support built-in melody source selection
- the feature must support an optional simple style preset
- the generated audio must use only the selected fart recordings as source material
- the same selected clips and same settings must produce the same arrangement
- the app must create a job record with visible status after submission
- the app must keep the pending job visible until completion or failure
- the app must update the job to ready or failed instead of removing it silently

## Inputs And Outputs

### Inputs

- selected source clips
- melody source
- optional simple style preset

### Output

- one generated song artifact
- one generation job record with visible status
- associated metadata such as:
  - job status
  - title
  - melody source
  - style preset, if selected
  - source clip count
  - source clip IDs

## Dependencies

### Product Dependencies

- Clip Source Selection
- post-MVP Musical Fruit foundation milestone complete
- playback
- place in the UI to show pending and completed generated songs

### Technical / Service Dependencies

- orchestration layer for prompt shaping
- deterministic local composition engine
- background jobs or queue
- generated-song storage
- audio preprocessing as needed

- [Services](../../../../../apps/.archive/docs/plan/features/services/README.md)
- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)

## Data / Tracking

- generation submitted
- generation source mode
- melody source selected
- style preset selected, if any
- generation job status changed
- generation completed
- generation failed

## Acceptance Criteria

- [ ] user can submit an original-song request from a chosen source set
- [ ] user can choose a built-in melody source
- [ ] user can optionally choose a simple style preset
- [ ] generated output uses only the selected fart recordings as source material
- [ ] repeated run with the same inputs produces the same arrangement
- [ ] app creates a visible `in progress` item after submission
- [ ] `in progress` item remains visible if the user leaves the loading screen
- [ ] completed jobs become playable results
- [ ] failed jobs remain visible and are recoverable

## Critical QA Scenarios

- happy path with each starter melody source
- happy path with no style preset selected
- repeated run with the same clips and settings
- leaving the loading screen while the job is still running
- returning after the job completes
- job failure after submission
- retry after failure

## Success Criteria

- users can finish an original-song request with lightweight input once the public flow ships
- users understand the creation options without confusion
- users can always find a submitted song while it is still `in progress`
- generation status feels explicit and recoverable
- the result feels connected to the selected source clips

## Related Docs

- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)
- [Clip Source Selection](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/clip-source-selection.md)
- [AI Smart Choose](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/ai-smart-choose.md)
- [Cover Song Concept](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/cover-song-concept.md)
