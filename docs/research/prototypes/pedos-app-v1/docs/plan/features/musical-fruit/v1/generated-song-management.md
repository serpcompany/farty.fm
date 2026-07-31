# Generated Song Management

Manage a generated song after it has been created in the later public Musical Fruit release.

## Status

- Scope: `Later`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

Generated Song Management covers the basic actions a user should have once a Musical Fruit song exists in the later public release. It focuses on keeping the result usable over time by letting the user rename it, give it a custom name, or delete it.

This is separate from song generation because it is a post-generation management flow, not part of creating the song in the first place.

## Target User And Moment

This feature is for users who already have one or more generated songs and want to organize or clean them up after creation.

Typical moments:

- the default generated title is weak and the user wants to rename it
- the user wants to give the song a custom funny name
- the user wants to delete a bad or unwanted generated song

## User Stories

- As a user, I can rename a generated song.
- As a user, I can give a generated song a custom name that feels funnier or more memorable.
- As a user, I can delete a generated song I do not want to keep.
- As a user, I can manage a song without losing track of which one I am editing.

## Release Scope

### In Scope

- rename generated song
- custom name generated song
- delete generated song
- confirmation before destructive delete

### Out Of Scope

- bulk song management
- folders, playlists, or collections
- advanced editing of metadata beyond the visible song name

### Future Expansion

- bulk delete
- tags or categories
- sort and filter tools for generated songs

## Primary UX Flow

### Rename / Custom Name Path

1. User opens a generated song result or generated-song list item.
2. User chooses a rename action.
3. App shows an editable song name field.
4. User saves the new name.
5. App updates the stored song metadata and shows the new name everywhere that song appears.

### Delete Path

1. User opens a generated song result or generated-song list item.
2. User chooses delete.
3. App shows a confirmation step.
4. User confirms delete.
5. App removes the generated song and updates the visible list or result state.

### Error / Failure Path

1. Rename or delete fails.
2. App shows a clear failure state.
3. User can retry without losing context.

## Screen Responsibilities

- `Generated Song Result`
  - show rename action
  - show delete action
  - reflect the current saved song name
- `Pending Song Item` or generated-song list
  - should reflect updated song names after rename
  - should remove deleted songs cleanly

- [UI Screens](../../../../../apps/.archive/docs/plan/features/ui/screens.md)

## UX Requirements

- renaming must feel quick and lightweight
- the current song name must always be obvious before delete
- delete must require confirmation
- the user must not be confused about whether they are editing the generated song title or the original source clips

## Functional Requirements

- the feature must support renaming a generated song
- the feature must support saving a custom song name
- the feature must support deleting a generated song
- the feature must confirm delete before removal
- renamed songs must show the updated name consistently across the feature

## Inputs And Outputs

### Inputs

- generated song ID
- updated custom song name, if renaming
- delete confirmation, if deleting

### Output

- updated generated song metadata
- deleted generated song state, if removed

## Dependencies

### Product Dependencies

- generated song result view
- generated-song list or visible pending/ready states
- later public Song Maker flow live in the app

### Technical / Service Dependencies

- generated-song metadata storage
- generated-song delete flow

- [Services](../../../../../apps/.archive/docs/plan/features/services/README.md)
- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)

## Acceptance Criteria

- [ ] user can rename a generated song
- [ ] user can save a custom name for a generated song
- [ ] user can delete a generated song
- [ ] delete requires confirmation
- [ ] renamed songs show the updated name consistently

## Critical QA Scenarios

- rename from generated song result
- rename to a custom funny name
- delete from generated song result
- delete confirmation cancel path
- rename failure
- delete failure

## Success Criteria

- users can keep the generated songs they want and remove the ones they do not
- song titles feel user-controlled instead of system-only
- post-generation cleanup feels simple and reliable

## Related Docs

- [Musical Fruit](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/README.md)
- [Original Song Generation](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/original-song-generation.md)
- [Generated Song Sharing](../../../../../apps/.archive/docs/plan/features/musical-fruit/v1/generated-song-sharing.md)
