# Feature Spec Template

Use this template when creating a new feature spec in `docs/plan/features/`.

The goal is to keep one source-of-truth doc per meaningful feature so product, design, engineering, and QA can all work from the same definition.

## How To Use This Template

- duplicate this file and rename it to the feature name
- delete any guidance text that does not apply
- keep the section order unless there is a strong reason not to
- keep the feature doc focused on behavior, scope, and testability
- use linked docs and issues for supporting detail instead of overloading the spec

---

# Feature Name

One-sentence description of what the feature does.

## Status

- Scope: `MVP` / `V1` / `Phase Two` / `Later`
- Status: `Draft` / `Ready` / `In Progress` / `Done`
- Owner: `TBD`
- App area: `TBD`
- Access: `Guest` / `Account` / `Premium` / `Gated`

## Summary

Explain the feature in 2-5 sentences.

Answer:

- what this feature is
- why it exists
- what it lets the user do

## Target User And Moment

Describe:

- who this feature is for
- when they use it
- what they are trying to get done

## Problem It Solves

Explain the user problem in plain language.

Good prompts:

- what is frustrating or missing without this feature
- why does this matter to the product
- why should we build this now

## User Stories

- As a user, I can ...
- As a user, I can ...
- As a user, I can ...

If useful, separate:

- primary user stories
- admin / support / internal user stories

## Release Scope

### In Scope

- ...
- ...
- ...

### Out Of Scope

- ...
- ...
- ...

### Future Expansion

- ...
- ...
- ...

## Primary UX Flow

### Happy Path

1. User does ...
2. App does ...
3. User sees ...
4. User completes ...

### Empty-State Path

1. User enters with no data / no eligibility.
2. App explains ...
3. Primary CTA sends them to ...

### Error / Failure Path

1. Something fails.
2. App shows ...
3. User can retry / recover by ...

### Alternate Paths

Use this section for meaningful flow branches such as:

- permission missing
- account required
- manual vs automatic mode
- different creation paths

## Screen Responsibilities

List the screens or flow steps that belong to the feature and what each one is responsible for.

Example:

- `Feature Home`
  - introduces the feature
  - shows eligibility / current state
- `Selection Step`
  - chooses source items
- `Result Screen`
  - shows output and next actions

Link the current screen doc if it exists:

- [UI Screens](./../ui/screens.md)

## UX Requirements

List the non-negotiable behavior and experience rules.

Examples:

- the user must understand what will happen before they commit
- the feature must not feel blocked or frozen during long-running work
- the user must be able to recover from common failure states
- the feature should stay lightweight in the first version

## Functional Requirements

List product requirements in direct language.

Examples:

- the user can start the feature from ...
- the app must save ...
- the system must validate ...
- the feature must support ...
- the feature must not require ...

## Inputs And Outputs

### Inputs

- ...
- ...
- ...

### Output

- ...
- ...
- ...

## Dependencies

### Product Dependencies

- what other product capabilities must exist first
- what this feature relies on from the main app

### Technical / Service Dependencies

- APIs
- storage
- background jobs
- permissions
- platform constraints

Link related planning docs when they exist:

- [Services](./../services/README.md)

## Data / Tracking

List any important data objects, metadata, or tracking needs.

Examples:

- records created
- key metadata fields
- analytics events
- logging events
- error states worth tracking

## Acceptance Criteria

- [ ] user can ...
- [ ] system does ...
- [ ] empty state behaves correctly
- [ ] failure state is recoverable
- [ ] output is saved or shown correctly

These should be concrete enough that QA and engineering can use them directly.

## Critical QA Scenarios

List the flows that absolutely must pass before the feature is considered ready.

Examples:

- first-time user happy path
- returning user happy path
- empty state
- permission denied path
- failed request / timeout path
- retry path
- save / persistence path
- delete / cancel path

## Success Criteria

Describe how we know the feature is working well from a product perspective.

Examples:

- users can complete the main flow without confusion
- failure states are understandable and recoverable
- output feels connected to the user action
- the feature is stable enough to support iteration

## Risks

List the real risks, not generic filler.

Examples:

- UX complexity
- cost / latency
- poor output quality
- support burden

## Open Decisions

- ...
- ...
- ...

## Related Links

- Feature index: [Features](./README.md)
- Primary feature planning doc: `TBD`
- Screen inventory: [UI Screens](./../ui/screens.md)
- Services: [Services](./../services/README.md)
- Related issues: `TBD`
- Related wireframes: `TBD`

---

## Short Checklist

Before calling the feature spec ready, confirm:

- the summary is understandable to a non-engineer
- the in-scope and out-of-scope sections are explicit
- the happy path and failure path both exist
- the acceptance criteria are testable
- the critical QA scenarios are listed
- the open decisions are visible instead of hidden in prose
