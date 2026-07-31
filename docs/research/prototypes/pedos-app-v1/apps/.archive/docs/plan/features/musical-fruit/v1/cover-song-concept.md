# Cover Song Concept

Explore a later cover-style song flow for Musical Fruit.

## Status

- Scope: `Later`
- Status: `Research`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

Cover Song Concept is the later Musical Fruit path where a user can type an artist name, song name, or both and ask Pedos AI to make a cover-style result from fart recordings.

This is not part of the core-app MVP or the first public Song Maker release. It is a separate subfeature because the product behavior and expectations are materially different from original-song generation.

## Target User And Moment

This feature is for users who want a more recognizable or parody-like result than a fully original song.

Typical moment:

- the user already understands the original-song flow
- they want something closer to "make this like a famous song" or "make this in the style of X"
- they are willing to provide a specific artist or song reference

## Problem It Solves

Original-song generation is funny and flexible, but some users will want a more specific comedic payoff. A cover-style concept gives the user a clearer target and can make the output feel more immediately understandable.

## User Stories

- As a user, I can enter an artist name, song name, or both as a creative reference.
- As a user, I can understand that this is a different path from original-song generation.
- As a user, I can see clear expectations before I submit a cover-style request.
- As a product team, we can evaluate this flow separately from original-song generation before deciding how to prioritize and implement it.

## Release Scope

### In Scope

- product definition and UX planning for a cover-style concept path
- typed artist input
- typed song input
- expectation-setting around what the request means

### Out Of Scope

- automatic public launch in the first public Song Maker release
- guarantee that the result matches a real song closely
- polished launch-ready implementation

### Future Expansion

- service-specific experimentation for style transfer or cover-like output

## Primary UX Flow

### Concept Flow

1. User enters Musical Fruit and chooses the cover-style concept path.
2. App explains that this is a different mode from original-song generation.
3. User can enter:
   - artist name
   - song name
   - artist + song name
4. User reviews the request before submission.
5. App submits the request and tracks it through the normal generation flow.

### Error / Failure Path

1. Input is incomplete, invalid, or not allowed.
2. App shows a clear message and lets the user revise the request.

## Screen Responsibilities

- `Song Type Selection`
  - distinguishes original-song generation from the cover-style concept path
- `Cover Song Input`
  - collects artist or song input
  - sets expectations before submission

- [UI Screens](./../../ui/screens.md)

## UX Requirements

- this path must feel clearly different from original-song generation
- the user must understand what they are asking for before submission
- the path should feel like a normal song option, not a hidden or blocked feature

## Functional Requirements

- the feature must support typed artist name input
- the feature must support typed song name input
- the feature must support artist + song input
- the feature must route into the normal generation flow after input is submitted

## Inputs And Outputs

### Inputs

- selected source clips
- artist name, if provided
- song name, if provided

### Output

- one cover-style concept request
- one request ready to submit into generation

## Dependencies

### Product Dependencies

- Musical Fruit parent flow
- source-clip selection
- clear song-type selection

### Technical / Service Dependencies

- music-generation service research
- prompt shaping
- moderation and policy decisions

- [Services](./../../services/README.md)
- [Musical Fruit](./README.md)

## Risks

- user expectation risk if the result does not resemble the requested reference
- service fit risk because not every provider supports this kind of request well

## Acceptance Criteria

- [ ] the feature is documented as a separate later path
- [ ] the user can enter artist and song reference inputs in the planned UX
- [ ] the request can route into the normal generation flow

## Critical QA Scenarios

- artist-only input
- song-only input
- artist + song input
- invalid or empty input

## Success Criteria

- the team can evaluate this path independently from original-song generation
- the existence of this concept does not confuse or weaken the simpler original-song path

## Related Docs

- [Musical Fruit](./README.md)
- [Original Song Generation](./original-song-generation.md)
