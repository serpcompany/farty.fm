# Musical Fruit Rollout Plan

## Status

- Scope: `Phase Two`
- Status: `Draft`
- Owner: `TBD`
- App area: `Musical Fruit`
- Access: `Account`

## Summary

The core-app MVP is not “AI music generation.”

The core-app MVP should ship without a public Musical Fruit song-maker flow.

For this feature area, the right next step after MVP is a foundation pass:

- clean sample-pack and clip metadata
- melody-template planning
- clip analysis and melody-fit scoring
- deterministic render tooling
- job and metadata contracts for later app integration

The public `Song Maker` release should happen only after that foundation work is strong enough to support a lightweight, reliable experience.

## Rollout Call

### Core-app MVP should:

- stay focused on recording, saving, playback, and account basics
- avoid launching any public Musical Fruit generation flow
- avoid overpromising AI-song behavior before the quality bar is proven

### First post-MVP Musical Fruit milestone should:

- prove the fart-only generation approach with internal tooling
- lock a small built-in melody library
- measure clip-fit quality before any public launch
- define the worker, metadata, and job-state contracts

### Later public Song Maker release should:

- use only the selected fart recordings as source material
- produce a short result that is clearly melody-shaped
- behave deterministically with the same inputs
- keep creative controls lightweight
- support a small built-in melody library first

### The public Song Maker release should not:

- depend on third-party music-generation APIs
- aim for realistic pop-song vocals
- try to be a full DAW or editing suite
- allow arbitrary song-name search in the first public release

## What Ships When

### Core-app MVP

- no Musical Fruit entry point
- no song-maker setup flow
- no generated-song list or playback

### First post-MVP foundation pass

- sample-pack maintenance path
- starter melody-template catalog
- clip analysis and pitch-fit scoring
- deterministic local melody-render CLI
- metadata contract for rendered artifacts
- evaluation harness for recognizability and fit

### Later public Song Maker release

1. User selects clips.
2. User chooses a melody source from the built-in list.
3. User optionally chooses a simple style preset.
4. User submits generation.
5. App creates a visible pending melody item.
6. Background job creates a deterministic fart-only melody using only those clips.
7. User gets a short recognizable phrase.

### Public Song Maker output shape

- one recognizable melody phrase
- no backing layers
- no non-fart instruments
- no lyric layer

The output should feel like:

- obviously built from fart sounds
- recognizably tied to the chosen melody source
- funny on first listen
- personal to the user’s selected clips

## Song Maker Rules

### Hard rules

- only selected fart recordings may be used as audio source material
- same selected clips + same settings + same seed must produce the same output
- all selected clips must be represented somewhere in the melody render when feasible
- bounded pitch shifting is allowed only to hit target melody notes
- no non-fart backing layers may be added

### Soft rules

- style should steer phrasing only, not add new instruments
- melody source should come from a built-in catalog, not free text
- the result can sound crude as long as it sounds intentional

## Starter Melody Library For The Later Public Release

Start with these `6` melodies:

- `The Star-Spangled Banner`
- `Happy Birthday`
- `Twinkle Twinkle Little Star`
- `Mary Had a Little Lamb`
- `Jingle Bells`
- `Yankee Doodle`

Each melody should be stored as structured data:

- title
- note sequence
- rhythm sequence
- public-domain status
- difficulty
- minimum recommended clip count
- minimum recommended clip spread

## Melody Difficulty And Clip Requirements

The app should treat melody choice as a fit check, not just a menu choice.

Recommended first-pass rules:

- easy melodies: `3-5` usable clips
- medium melodies: `5-8` usable clips
- hard melodies: `8+` usable clips

Examples:

- `Mary Had a Little Lamb`
  - easy
  - works with fewer clips
- `Twinkle Twinkle Little Star`
  - easy
  - works with fewer clips
- `Happy Birthday`
  - medium
  - needs a bit more spread
- `Jingle Bells`
  - medium
  - benefits from more variation
- `Yankee Doodle`
  - medium
  - benefits from more variation
- `The Star-Spangled Banner`
  - hard
  - should probably require `8+` good tonal clips before the app claims it can render it well

## Melody Fit Gate

Before generation, the app should score whether the chosen clips are sufficient for the chosen melody.

The gate should check:

- enough selected clips
- enough tonal spread across clips
- enough sustained clips for longer notes
- enough distinct usable note sources to avoid overusing one clip

If the chosen clip set is weak, the app should:

- warn that the melody may not come out recognizable
- suggest using more clips
- suggest an easier melody
- avoid pretending the current selection is a strong fit

## How The User Chooses A Melody Source

For the later public Song Maker release, the user should choose from a built-in melody picker.

The app should not support free-text song name entry yet.

The first public release should show:

- title
- maybe a simple category later
- maybe a difficulty or clip-fit hint later

## Recommended Engine

Use a deterministic local melody pipeline:

1. preprocess selected clips
   - trim silence
   - normalize loudness
   - detect duration and tonal usefulness
2. choose a built-in melody template
3. map selected clips onto target melody notes
   - prefer natural fit first
   - use bounded pitch shifting only when needed
   - require enough usable clips for harder melodies
4. render one fart-only melody line
5. export audio plus metadata

## How We Make A Test A Tool

The first useful tool is a repeatable melody-render CLI. That same harness starts as a test bed and then becomes the production worker behind the app job.

### Meaning in practice

- define a fixed input contract:
  - selected clip IDs or paths
  - melody ID
  - optional style preset
  - seed
- define a fixed output contract:
  - rendered audio file
  - metadata JSON
  - melody assignment summary
  - pitch-shift summary
- make a CLI tool that runs the exact melody pipeline from those inputs
- use that CLI in automated tests first
- later call that same tool from the app’s background job

### Why this is the right pattern

- every manual experiment becomes reproducible
- deterministic behavior becomes testable
- source-clip usage becomes inspectable
- the “test runner” becomes the actual generation worker

## Foundation Tool Requirements

The first internal melody tool should support:

- one selected clip
- many selected clips
- one chosen melody source from the starter library
- explicit seed
- saving audio output to project `tmp/`
- saving metadata describing:
  - selected clip IDs
  - which clips were actually used
  - melody ID
  - melody difficulty
  - fit score or fit warning
  - pitch shift per note event
  - note sequence and rhythm

## Acceptance Tests

### Foundation pass

- [ ] sample-pack regeneration works from the source audio when it is available
- [ ] checked-in metadata can still be used safely when the raw sample pack is absent in a local checkout
- [ ] melody templates are stored as structured data with difficulty and clip-fit metadata
- [ ] render metadata is inspectable enough to debug clip use and pitch shifting
- [ ] evaluation outputs are saved in a repeatable way for listening review

### Later public Song Maker core behavior

- [ ] same inputs and same seed produce the same output hash
- [ ] output metadata lists all selected clip IDs
- [ ] output metadata shows every selected clip was used
- [ ] output metadata lists the chosen melody source
- [ ] pitch shifts stay within the allowed bound
- [ ] hard melodies are blocked or warned when there are not enough usable clips

### Later public Song Maker listening tests

- [ ] result sounds recognizably like the chosen melody
- [ ] three-clip result clearly uses more than one source clip
- [ ] melody still sounds like fart audio and not a normal instrument
- [ ] the melody is still recognizable after bounded pitch shifting

### Later public Song Maker app flow tests

- [ ] submitting generation creates a visible `in progress` item
- [ ] completed job becomes playable
- [ ] failed job remains visible and retryable

## Proposed Build Phases

### Phase 1: Foundation Tooling

- [x] create a deterministic local melody CLI
- [x] support explicit melody ID and selected input clips
- [x] save rendered audio and metadata
- [x] add unit tests for melody catalog and deterministic note planning
- [ ] add golden-style determinism tests on rendered audio
- [x] write or update implementation docs

### Phase 2: Quality Gate And Contracts

- [ ] finalize the starter `6` melody templates
- [ ] add minimum recommended clip count and difficulty metadata per melody
- [ ] add preflight melody-fit scoring before render
- [ ] add melody-fit hints for selected clips
- [ ] add tests for melody-template selection and metadata
- [ ] document melody library behavior
- [ ] define generated-song metadata and job-state contract for app integration
- [ ] decide the minimum quality bar that unlocks a public launch

### Phase 3: Later Public Song Maker Release

- [ ] add Musical Fruit entry in the app after core MVP is stable
- [ ] add user-facing clip-source flow and melody setup
- [ ] hook app submission flow to the melody CLI
- [ ] save output artifact and metadata
- [ ] expose `in progress`, `failed`, and ready states in the UI
- [ ] add integration tests for job lifecycle
- [ ] update feature docs

### Phase 4: Listening QA Pass

- [ ] manually review sample clips for issue `#3`
- [ ] run listening pass on representative seeds
- [ ] tighten melody-fit rules and shift bounds
- [ ] record QA findings in `docs/knowledge`

## Suggested First Implementation Slice

Build the smallest end-to-end foundation slice:

1. accept `3` selected clips and one built-in melody
2. map those clips onto the chosen melody line
3. render one recognizable opening phrase
4. export WAV plus metadata JSON
5. prove deterministic output with a repeat test

## Related Docs

- [Musical Fruit](./README.md)
- [Original Song Generation](./original-song-generation.md)
- [API Comparison Spike](./api-comparison-spike.md)
- [Pedos AI Audio API Runs](./../../../knowledge/pedos-ai-audio-api-runs.md)
