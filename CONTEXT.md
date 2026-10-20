# Pedos

Pedos is a web app (installable from the browser) that turns a person's fart recordings into recordings they can replay and Toots they can make: Songs played by their farts.

## Recordings

**Recording**:
A single fart audio clip captured and saved by a user. One Recording must not contain multiple fart events.
_Avoid_: Sample, sound, track, clip

**Recording Analysis**:
The characteristics derived once from a saved Recording and preserved with it, such as its single clean gesture and its pitch. Saving and playback never wait on it.
_Avoid_: Live analysis, reanalysis

**Melodic Recording**:
A Recording whose pitch is steady enough to carry melody notes.
_Avoid_: Pitched fart, tonal fart, good Recording

**Noise-like Recording**:
A Recording with no steady pitch. It can still be placed on a note, but it can't tell the listener which note.
_Avoid_: Bad Recording, unpitched fart

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
How well a set of Melodic Recordings can play a particular Song, judged by how far each Recording would have to be moved to reach the notes it plays.
_Avoid_: Song match, quality score

**Pitch Coverage**:
How many of a Song's distinct pitches are covered, each by its own Melodic Recording within 3 semitones of it or close enough for an Octave Move, shown as "3 of 4 notes covered".
_Avoid_: Progress, completion

**Unlocked Song**:
A Song whose Pitch Coverage is complete: every distinct pitch has its own Melodic Recording.
_Avoid_: Available song, playable song

**Arrangement**:
Which Recording plays each note of a melody.
_Avoid_: Mapping, mix, assignment

**Octave Move**:
A Melodic Recording playing a note about an octave from its Recording Pitch: resampled 12 semitones up or down, plus at most 3. Used only where a Song can't be covered without it.
_Avoid_: Octave folding, octave jump

**Auto-map**:
The Arrangement the app chooses on its own, giving each distinct pitch its own Melodic Recording, with as few Octave Moves as possible and then as close in pitch as possible.
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
_Avoid_: Pedos AI, AI music

## Testing

**Internal Tester**:
A developer-side evaluator who can use controlled test material and capabilities that regular users never see.
_Avoid_: Admin, regular user

**Fixture Library**:
The curated set of real fart Recordings available only to Internal Testers and development tools for repeatable evaluation. The web app's tests and development tools read it from the repository, for example as the e2e tests' fake microphone; no web build contains it.
_Avoid_: Sample library, starter recordings, user library
