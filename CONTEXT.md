# Farty

Farty is a web app (installable from the browser) that turns a person's fart recordings into recordings they can replay and Toots they can make: Songs played by their farts.

It was called Pedos until 2026-10-22 (ADR 0009). Users only ever see Farty. Internal names keep Pedos: the repository, folders, code identifiers and the `pedos` browser database.

## Recordings

**Recording**:
A single fart audio clip captured and saved by a user. One Recording must not contain multiple fart events.
_Avoid_: Sample, sound, track, clip

**Recording Analysis**:
The characteristics derived once from a saved Recording and preserved with it, such as its single clean gesture and its pitch. Saving and playback never wait on it.
_Avoid_: Live analysis, reanalysis

**Melodic Recording**:
A Recording whose pitch is steady enough to carry melody notes. In Songs, Pitch Coverage and the Recordings tab's count, a Placed Recording counts as one, at its Placed Pitch (ADR 0015).
_Avoid_: Pitched fart, tonal fart, good Recording

**Noise-like Recording**:
A Recording with no steady pitch, so it can't tell the listener which note it is. Songs leave it out unless the user places it on a note by ear (a Placed Recording).
_Avoid_: Bad Recording, unpitched fart

**Placed Pitch**:
The note, C2 to B4, that the user placed a Noise-like Recording on by ear, on the Recordings tab: the piano key they hear as closest to the fart. Set once per Recording, used in every Song, kept with the Recording and its account, and through a new analysis. The fart still plays raw (ADR 0012): the note says only where Songs use it, never how it sounds (ADR 0015).
_Avoid_: Tuned pitch, assigned pitch, Recording Pitch (that is the analyzed one)

**Placed Recording**:
A Noise-like Recording with a Placed Pitch. Songs, Pitch Coverage and Auto-map treat it as a Melodic Recording at its Placed Pitch. Leaving it out, the default, keeps it out of Songs.
_Avoid_: Beat, tuned fart

**Recording Pitch**:
The note a Melodic Recording naturally sounds, octave included: G2 and G3 are different Recording Pitches. A Recording has a pitch; it never has a key.
_Avoid_: Key, tone

## Songs and Toots

**Song**:
A known melody in the Song Catalog, taken from a cited public-domain score.
_Avoid_: Track, tune, curated melody

**Song Catalog**:
The set of Songs shipped with the app, each with its preserved source and license.
_Avoid_: Melody pool, song library, melody library

**Melody Fit**:
How well a set of Melodic Recordings can play a particular Song, judged by how far each Recording's pitch is from the notes it plays, and how much of each note it fills.
_Avoid_: Song match, quality score

**Pitch Coverage**:
How many of a Song's distinct pitches are covered, shown as "3 of 4 notes covered". A pitch is covered by its own Melodic Recording (a Placed Recording counts, at its Placed Pitch) within 3 semitones of it or close enough for an Octave Move, that lasts at least as long as the pitch's longest note (ADR 0011). A missing pitch names the shortest fart that would cover it: "Needs a fart near F3 (1.2 s)".
_Avoid_: Progress, completion

**Unlocked Song**:
A Song whose Pitch Coverage is complete: every distinct pitch has its own Melodic Recording, near enough in pitch and long enough for its longest note.
_Avoid_: Available song, playable song

**Arrangement**:
Which Recording plays each note of a melody. Each Recording plays raw, at its own pitch and speed (ADR 0012), so a Toot sounds near the melody, not on it.
_Avoid_: Mapping, mix, assignment

**Octave Move**:
A Melodic Recording covering a note about an octave from its Recording Pitch: 12 semitones up or down, give or take 3. It plays raw, so it sounds an octave from the note (ADR 0012). Used only where a Song can't be covered without it.
_Avoid_: Octave folding, octave jump

**Auto-map**:
The Arrangement the app chooses on its own, giving each distinct pitch its own Melodic Recording that is long enough for it, with as few Octave Moves as possible and then as close in pitch as possible. A Placed Recording takes part at its Placed Pitch, counted as holding its note only from 0.6 s, so an analyzed fart at the same distance gets the shorter notes (ADR 0015).
_Avoid_: Smart choose, AI pick, best fit

**Toot**:
A saved result: a Song played with the user's Recordings, made in Song Creator. It keeps which Recording played each pitch. It is not a conventional song or a music release.
_Avoid_: Created Melody, Melody, Created Song, generated song, track, output

## Creation areas

**Song Creator**:
The creation area that plays a Song using only the user's Recordings as sound.
_Avoid_: Musical Fruit, standard song creator

**AI Song Creator**:
The creation area where AI composes a new melody that is played using only the user's Recordings. It adds no vocals, instruments, or backing tracks.
_Avoid_: Farty AI, AI music

## Testing

**Internal Tester**:
A developer-side evaluator who can use controlled test material and capabilities that regular users never see.
_Avoid_: Admin, regular user

**Fixture Library**:
The curated set of real fart Recordings available only to Internal Testers and development tools for repeatable evaluation. The web app's tests and development tools read it from the repository, for example as the e2e tests' fake microphone. Staging builds carry it behind the password gate, for testing; Production builds never contain it.
_Avoid_: Sample library, starter recordings, user library
