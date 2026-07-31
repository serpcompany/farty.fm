# Clip Source Selection

Choose which fart clips will be used for a later Musical Fruit song.

## Status

- Scope: `Later`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

Clip Source Selection is the later public step where the user decides what source material goes into song generation. It exists so the user stays in control of how much of their fart history is used and so the generation feels intentional rather than random.

The user should be able to take the fast path with `use all farts`, manually pick specific clips, or hand off selection to `AI Smart Choose`.

## Target User And Moment

This feature is for users who already entered the later public Musical Fruit flow and need to decide what clips should feed the song generator.

They are trying to answer:

- use everything
- use a hand-picked set
- let the app choose

## User Stories

- As a user, I can use all eligible clips without manually picking each one.
- As a user, I can choose specific clips to control what goes into the song.
- As a user, I can see how many clips are selected before continuing.
- As a user, I can switch to AI Smart Choose if I do not want to pick manually.

## Release Scope

### In Scope

- `use all farts`
- `choose farts to use`
- path into `AI Smart Choose`
- selected-count feedback
- eligibility rules for what clips can be used

### Out Of Scope

- deep waveform editing before selection
- advanced filtering and sorting tools
- manual trim or normalization inside this step

### Future Expansion

- richer filters such as date, duration, or tags
- saved source presets
- recommended source sets

## Primary UX Flow

### Happy Path

1. User enters Clip Source Selection after starting the later public Musical Fruit song-maker flow.
2. App shows the available source modes.
3. User chooses one of:
   - `use all farts`
   - `choose farts to use`
   - `AI smart choose`
4. If the user chooses manual selection, the app shows eligible clips with selectable states.
5. User confirms the source choice and continues to song generation.

### Empty-State Path

1. User enters the feature with no eligible clips.
2. App explains that there is not enough source material yet.
3. Primary CTA routes back to recording or history.

### Error / Failure Path

1. Clip list cannot load or eligibility cannot be determined.
2. App shows a recoverable failure state.
3. User can retry or leave the flow.

### Alternate Paths

- `use all farts` skips manual selection and moves straight to the next step
- `AI smart choose` routes into the AI Smart Choose review flow

## Screen Responsibilities

- `Clip Source Selection`
  - explains the three source modes
  - shows available clips if manual selection is chosen
  - shows selected count before continue
- `AI Song Creator Home`
  - should make it clear whether the user has enough clips to begin

- [UI Screens](../../../../../apps/.archive/docs/plan/features/ui/screens.md)

## UX Requirements

- the user must understand what each source mode does before choosing it
- manual selection must make it obvious how many clips are currently selected
- the step should stay lightweight and not feel like a media-management tool

## Functional Requirements

- the feature must support `use all farts`
- the feature must support manual clip selection
- the feature must support a route into `AI Smart Choose`
- the app must show selected-count feedback before continue
- the app must block continuation if zero clips are selected in manual mode

## Inputs And Outputs

### Inputs

- eligible saved clips
- chosen source mode
- manual clip selection, if used

### Output

- final source mode
- selected clip IDs, if applicable
- continue state into the next feature step

## Dependencies

### Product Dependencies

- stable saved clip history
- clip metadata the user can understand
- post-MVP Musical Fruit foundation milestone complete

### Technical / Service Dependencies

- eligibility rules
- clip lookup from the saved library

- [Services](../../../../../apps/.archive/docs/plan/features/services/README.md)
- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)

## Acceptance Criteria

- [ ] user can choose `use all farts`
- [ ] user can manually choose specific clips
- [ ] user can route into `AI Smart Choose`
- [ ] selected-count feedback is visible before continue
- [ ] zero-selection state is handled correctly

## Critical QA Scenarios

- happy path using all clips
- happy path using manual selection
- zero eligible clips
- zero manual clips selected
- clip list load failure

## Success Criteria

- users can choose source clips without confusion
- the source choice feels fast and understandable
- users understand what will be used before generation begins

## Related Docs

- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)
- [AI Smart Choose](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/ai-smart-choose.md)
- [Original Song Generation](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/original-song-generation.md)
