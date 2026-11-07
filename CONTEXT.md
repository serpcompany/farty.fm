# Farty

Farty is a web app (installable from the browser) that turns a person's fart recordings into recordings they can replay and Toots they can make: Songs played by their farts.

It was called Pedos until 2026-10-22 (ADR 0009). Users only ever see Farty. Internal names keep Pedos: the repository, folders, code identifiers and the `pedos` browser database.

## Recordings

**Recording**:
A single fart audio clip captured and saved by a user. One Recording must not contain multiple fart events. It has a name, "Recording 12" by its number until the user names it in its review (#314).
_Avoid_: Sample, sound, track, clip

**Review**:
Where the user sets a Recording's Trim, note and name: right after Stop, before Save, and later from the Recording's pencil on the Recordings tab. Saving never waits on Recording Analysis (#314).
_Avoid_: Picker, editor

**Recording Analysis**:
The characteristics derived once from a saved Recording and preserved with it, such as its gesture and its pitch. The gesture is the whole fart, every burst of it, from just before its attack to where it fades out. It is never cut at a second burst. Songs play it from the note's beat, and a quieter lead-in before the attack just before the beat, when the rest before the note has room (#287). The pitch is read from its first burst, so a second one can't blur it (ADR 0016). The saved file stays the whole take, and the Recordings tab plays all of it. Saving and playback never wait on it.
_Avoid_: Live analysis, reanalysis

**Melodic Recording**:
A Recording whose pitch is steady enough to carry melody notes. In Songs, Pitch Coverage and the Recordings tab's count, a Placed Recording counts as one, at its Placed Pitch (ADR 0015).
_Avoid_: Pitched fart, tonal fart, good Recording

**Noise-like Recording**:
A Recording with no steady pitch, so it can't tell the listener which note it is. Songs leave it out unless the user gives it a note by ear in its review (a Placed Recording).
_Avoid_: Bad Recording, unpitched fart

**Placed Pitch**:
The note, C2 to B4, that the user gave a Recording by ear in its review: the piano key they hear as closest to the fart. Any Recording can have one, a Melodic one on another note than its Recording Pitch included; picking the note analysis found clears it (#314). Set once per Recording, used in every Song, kept with the Recording and its account, and through a new analysis. If a later analysis finds the fart a Recording Pitch, the Placed Pitch stays the one used, since the user chose it (ADR 0017). The fart still plays raw (ADR 0012): the note says only where Songs use it, never how it sounds (ADR 0015).
_Avoid_: Tuned pitch, assigned pitch, Recording Pitch (that is the analyzed one)

**Placed Recording**:
A Recording with a Placed Pitch. Songs, Pitch Coverage and Auto-map treat it as a Melodic Recording at its Placed Pitch, even after a later analysis finds a Recording Pitch (ADR 0017). "No note" leaves a Recording out of Songs: a Noise-like one by default, or a Melodic one the user leaves out (ADR 0015).
_Avoid_: Beat, tuned fart

**Trim**:
The part of a Recording's take the user kept with the review's two handles; any Recording can be trimmed (#314). The Recordings tab and the review then play exactly what's between the handles, and Songs play the fart found between them, whose length is the fart's length. The saved take never changes, and Reset, then Save, brings the whole fart back. Kept with the Recording and its account, and through a new analysis, a Re-scan included (ADR 0017). It never changes the fart's pitch: a trimmed Melodic Recording keeps its Recording Pitch (ADR 0019).
_Avoid_: Crop, edit, clip

**Recording Pitch**:
The note a Melodic Recording naturally sounds, octave included: G2 and G3 are different Recording Pitches. A Recording has a pitch; it never has a key. Recording Analysis reads it from the first 450 ms of the first burst or, when those have none, from the 450 ms where its pitch starts (ADR 0017).
_Avoid_: Key, tone

**Re-scan**:
Running the current Recording Analysis again on a Recording with no note (Noise-like and not placed) whose analysis an older Recording Analysis made, from the Recordings tab: one Recording, or all of them one at a time. It says how many now have a note. It never changes a Placed Pitch, and it changes only this browser's analysis (ADR 0017).
_Avoid_: Reanalysis, re-analyze, refresh

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
A Song whose Pitch Coverage is complete: every distinct pitch has its own Melodic Recording, near enough in pitch and long enough for its longest note. A fart left out of the Song by its Fart Choices doesn't count (#372).
_Avoid_: Available song, playable song

**Favorite Song**:
A Song the user marked in Compose, kept with their account.
_Avoid_: Liked song, starred song, saved song

**Arrangement**:
Which Recording plays each note of a melody. Each Recording plays raw, at its own pitch and speed (ADR 0012), so a Toot sounds near the melody, not on it.
_Avoid_: Mapping, mix, assignment

**Fart Choices**:
The changes a user makes to one Song's Arrangement in Song Creator: a fart swapped in to play one of its pitches, and farts left out of the Song (#360). Auto-map, called Farty's pick in the app, still arranges every pitch they don't settle, so leaving out a pitch's only fart locks the Song. Kept per Song with the account. The Song's notes never change (ADR 0005).
_Avoid_: Overrides, manual mapping, custom arrangement

**Octave Move**:
A Melodic Recording covering a note about an octave from its Recording Pitch: 12 semitones up or down, give or take 3. It plays raw, so it sounds an octave from the note (ADR 0012). Used only where a Song can't be covered without it.
_Avoid_: Octave folding, octave jump

**Auto-map**:
The Arrangement the app chooses on its own, giving each distinct pitch its own Melodic Recording that is long enough for it, with as few Octave Moves as possible and then as close in pitch as possible. A Placed Recording takes part at its Placed Pitch, counted as holding its note only from 0.6 s, so an analyzed fart at the same distance gets the shorter notes (ADR 0015).
_Avoid_: Smart choose, AI pick, best fit

**Toot**:
A saved result, of one of two kinds: a Song played with the user's Recordings, made in Song Creator, which keeps which Recording played each pitch and the Song's notes as it was rendered from them, so it still draws what its audio plays after the Song Catalog changes (#254); or a Sound Pad Performance, which keeps which Pad's Recording was tapped and when (ADR 0017). It is not a conventional song or a music release.
_Avoid_: Created Melody, Melody, Created Song, generated song, track, output

**Full Access**:
One purchase per account that lets every Save keep its Toot and every saved Toot download as a file (ADR 0022, #408). An account that paid for a Toot before it has it too, and a full refund ends it. It doesn't change which Songs are Unlocked Songs.
_Avoid_: Premium, Pro, subscription, unlock

## Creation areas

**Song Creator**:
The creation area that plays a Song using only the user's Recordings as sound. Its Piano choice plays the Song's melody on piano to compare with, which never reaches the Toot (ADR 0015, #359).
_Avoid_: Musical Fruit, standard song creator

**AI Song Creator**:
The creation area where AI composes a new melody that is played using only the user's Recordings. It adds no vocals, instruments, or backing tracks.
_Avoid_: Farty AI, AI music

**Sound Pad**:
The creation area of twelve Pads, where the user plays their Recordings by tapping them, with several at once if they like. Each fart plays raw, trimmed of the silence and room noise around it, and starts where a Song starts it, so a much quieter sound before its attack goes too.
_Avoid_: Sampler, soundboard, drum pad, launchpad

**Pad**:
One of the Sound Pad's buttons, holding one Recording of any kind, which a tap plays at once. The Pads start filled with the user's Recordings, lowest Recording Pitch first, and the user can put any Recording on any Pad. The browser keeps which Recording each Pad holds; a guest's Pads last the visit.
_Avoid_: Button, slot, key

**Performance**:
What the Sound Pad records between Record and Stop: which Recording each tap played, and when, from the first tap, for up to 30 s. Stop makes it into a Toot, each tap's fart playing raw from its start (ADR 0017).
_Avoid_: Sequence, pattern, loop, beat, track

## Sharing

**Handle**:
The name a user's links carry, as in `farty.fm/@<handle>/r/<name>`. The user picks it the first time they share: 3 to 20 lowercase letters, numbers or `_`, unique, and not on Farty's block list. It is the only thing about the user a Shared Recording shows. Only a user with an account has one (ADR 0020).
_Avoid_: Username, display name, screen name

**Shared Recording**:
A Recording its owner has shared by link, which anyone with the link can open and play, signed in or not, without the link being listed anywhere. The page shows the Handle, the Recording's name, note, length and waveform, and plays the part of the fart its row plays. Stop sharing, deleting the Recording, deleting the account, or Farty taking it down after a Report ends the link for everyone. Sharing it again brings the link back if nothing else has taken its name, and whatever is shared by that name next takes the link (ADR 0020). A Shared Toot works the same way, for a saved Toot.
_Avoid_: Public Recording, post, upload, published Recording

**Friend**:
Another user, found by their Handle, who has accepted a friend request from the user, or whose request the user accepted. Either can remove the other, and the other isn't told. Friends are listed in Profile, each opening their Profile Page (ADR 0021).
_Avoid_: Follower, contact, connection

**Profile Page**:
A user's page, `farty.fm/@<handle>`, which anyone can open. It has a banner of their newest shared Toot, their Handle and Add friend, then what they share now under a Toots tab and a Recordings tab, newest first. No counts and no feed. Not Profile, the tab that is the user's own account and settings (ADR 0021).
_Avoid_: Profile (for this page), wall, timeline

## Testing

**Internal Tester**:
A developer-side evaluator who can use controlled test material and capabilities that regular users never see.
_Avoid_: Admin, regular user

**Fixture Library**:
The curated set of real fart Recordings available only to Internal Testers and development tools for repeatable evaluation. The web app's tests and development tools read it from the repository, for example as the e2e tests' fake microphone. Staging builds carry it behind the password gate, for testing; Production builds never contain it.
_Avoid_: Sample library, starter recordings, user library
