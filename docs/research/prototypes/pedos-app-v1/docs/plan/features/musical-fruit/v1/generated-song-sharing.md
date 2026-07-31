# Generated Song Sharing

Share a generated song from Musical Fruit.

## Status

- Scope: `Later`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

Generated Song Sharing covers the ability to share a generated Musical Fruit song after it is ready. This happens after the later public Song Maker release is already live. The first clear sharing path is a direct link to the song.

This is separate from generation and basic song management because sharing introduces distribution behavior, link handling, and different storage expectations.

## Target User And Moment

This feature is for users who already have a generated song they want to send outside the app.

Typical moment:

- the user likes the result and wants to send it to someone else
- the user wants a simple share action instead of exporting files manually

## User Stories

- As a user, I can share a generated song.
- As a user, I can get a direct link to the song.
- As a user, I can understand what I am sharing before I send it.

## Release Scope

### In Scope

- share action from a generated song
- direct link to song
- clear share destination behavior through normal iPhone share flows

### Out Of Scope

- social feed or in-app community sharing
- public profiles
- advanced analytics on share performance

### Future Expansion

- richer share cards or previews
- separate private vs public share modes
- downloadable export formats

## Primary UX Flow

### Share Path

1. User opens a generated song result.
2. User taps share.
3. App prepares a song link.
4. User shares the song link through an iPhone share destination.

### Error / Failure Path

1. Link generation or share preparation fails.
2. App shows a clear failure state.
3. User can retry.

## Screen Responsibilities

- `Generated Song Result`
  - show share action
  - make it clear that the user is sharing a song link

- [UI Screens](../../../../../apps/.archive/docs/plan/features/ui/screens.md)

## UX Requirements

- share must feel fast and obvious
- the user must understand that the first shareable output is a link to the song
- the user should not need to manually copy raw storage URLs

## Functional Requirements

- the feature must support a share action from a generated song
- the feature must support generating a song link
- the feature must support sending that link into normal iPhone share flows

## Inputs And Outputs

### Inputs

- generated song ID

### Output

- shareable song link
- system share handoff

## Dependencies

### Product Dependencies

- generated song result screen
- stable generated song storage

### Technical / Service Dependencies

- generated song link generation
- storage access rules for shared songs

- [Services](../../../../../apps/.archive/docs/plan/features/services/README.md)
- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)

## Acceptance Criteria

- [ ] user can start a share flow from a generated song
- [ ] app can produce a link to the song
- [ ] user can share that link through normal iPhone share destinations

## Critical QA Scenarios

- happy path share from generated song result
- failed link generation
- repeat share on an existing generated song

## Success Criteria

- users can easily send a generated song to other people
- the share flow feels lighter than manual export
- the shared output is clearly a link to the song

## Related Docs

- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)
- [Original Song Generation](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/original-song-generation.md)
- [Generated Song Management](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/generated-song-management.md)
