# AI Smart Choose

Let the app propose the best fart clips for a later song-generation flow.

## Status

- Scope: `Later`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

AI Smart Choose is the assisted source-selection mode inside the later public Musical Fruit flow. Instead of making the user pick clips manually, the app proposes a set of clips that should work well for generation.

This feature exists to reduce friction for users who want a good result quickly and do not care about picking every clip themselves.

## Target User And Moment

This feature is for users who want to generate a song from their saved clips in the later public flow but do not want to manually choose the source set.

They want the app to help without turning the process into a black box.

## User Stories

- As a user, I can let the app pick clips for me.
- As a user, I can review the proposed clips before generation starts.
- As a user, I can accept the proposed set or go back and change it.
- As a user, I can understand that the app made a suggestion, not an irreversible decision.

## Release Scope

### In Scope

- AI-assisted or rules-based source recommendation
- preview of the proposed clip set
- accept or revise flow

### Out Of Scope

- invisible auto-submission with no review
- advanced explanation UI for why each clip was chosen
- personalized long-term taste modeling

### Future Expansion

- richer explanations for why clips were selected
- alternative proposed sets
- quality scoring or ranking

## Primary UX Flow

### Happy Path

1. User chooses `AI smart choose` from Clip Source Selection.
2. App or orchestration layer proposes a clip set.
3. User sees the proposed set before generation.
4. User accepts the set or goes back to revise it.
5. Accepted selection continues into Original Song Generation.

### Empty-State Path

1. There are not enough eligible clips to produce a meaningful recommendation.
2. App explains that more source material is needed.
3. User can return to recording or choose another path.

### Error / Failure Path

1. The suggestion step fails or times out.
2. App shows a recoverable failure state.
3. User can retry or return to manual selection.

## Screen Responsibilities

- `AI Smart Choose Review`
  - show proposed clips
  - explain that the set was suggested by the app
  - allow accept or revise

- [UI Screens](./../../ui/screens.md)

## UX Requirements

- AI Smart Choose should feel helpful, not opaque
- the user must see the proposed set before generation starts
- the user must be able to back out without losing control

## Functional Requirements

- the app must be able to propose a clip set from eligible saved clips
- the app must show the proposed set before submission
- the user must be able to accept or revise the proposed set
- failure must route cleanly back to retry or manual selection

## Inputs And Outputs

### Inputs

- eligible saved clips
- selection heuristics or AI assistance

### Output

- proposed clip set
- accepted clip IDs for generation

## Dependencies

### Product Dependencies

- Clip Source Selection
- stable clip history
- post-MVP Musical Fruit foundation milestone complete

### Technical / Service Dependencies

- orchestration layer
- clip metadata

- [Services](./../../services/README.md)
- [Musical Fruit](./README.md)

## Acceptance Criteria

- [ ] user can choose AI Smart Choose from source selection
- [ ] user sees the proposed clip set before generation
- [ ] user can accept or revise the selection
- [ ] failure state is recoverable

## Critical QA Scenarios

- happy path with a proposed clip set
- user rejects the set and goes back
- not enough clips for recommendation
- suggestion failure or timeout

## Success Criteria

- users feel the feature saves effort without removing control
- the proposed set feels plausible enough to trust
- the review step prevents the feature from feeling like a black box

## Related Docs

- [Musical Fruit](./README.md)
- [Clip Source Selection](./clip-source-selection.md)
- [Original Song Generation](./original-song-generation.md)
