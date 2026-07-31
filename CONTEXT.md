# Pedos

Pedos is an audio-creation product that turns a person's fart recordings into recordings they can replay and songs they can create.

## Language

**Recording**:
A single fart audio clip captured and saved by a user for playback or use as source material in a melody. One Recording must not contain multiple fart events.
_Avoid_: Sample, sound, track

**Recording Analysis**:
Preserved characteristics derived from a saved Recording by a separate analysis process, such as its usable pitch and duration qualities. Capture and local persistence do not depend on a particular analysis method.
_Avoid_: Live analysis, reanalysis

**Melody Fit**:
The compatibility between a set of Recordings and a target melody, accounting for how much the Recordings would need to be altered to render the melody acceptably.
_Avoid_: Song match, quality score

**Internal Tester**:
A developer-side evaluator who can exercise the app with controlled test material and capabilities that regular users never see.
_Avoid_: Admin, regular user

**Fixture Library**:
A curated collection of fart recordings available only to Internal Testers for repeatable on-device evaluation.
_Avoid_: Sample library, starter recordings, user library

**Song Creator**:
The creation area that renders a known melody chosen from a curated library using only supplied Recordings as audio material.
_Avoid_: Musical Fruit, standard song creator

**AI Song Creator**:
The creation area where AI composes a new melody plan that is rendered using only supplied Recordings as audio material. It does not add vocals, conventional instruments, or produced backing tracks.
_Avoid_: Pedos AI, AI music

**Created Melody**:
A playable fart-only melody produced by Song Creator or AI Song Creator. It is not a conventional song, original track, or professional music release.
_Avoid_: Created Song, generated song, track, output
