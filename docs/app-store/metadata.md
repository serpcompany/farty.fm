# App Store metadata (draft)

Draft listing text for App Store Connect (#75). **Nothing here has been submitted.** The owner
reviews it, picks the name, and fills App Store Connect (or approves an agent doing it step by
step).

The copy describes the app as it must be at submission: real Toots made from your own Recordings
(#16, #17). Today's Release build can record, save and find each fart's note, but can't make Toots
yet, so this listing doesn't match it until rendering lands (guidelines 2.1, 2.3 and 4.2).

Character counts are Apple's limits, counted with Python's `len()` on the exact text in each code
block (Unicode characters; App Store Connect counts the same way for these fields).

## Name (30 characters max)

Two options. The home-screen name stays **Pedos** either way (`CFBundleDisplayName`).

| Option | Characters | Notes |
| --- | --- | --- |
| `Pedos` | 5 | Short and the app's real name. "Pedos" means farts in Spanish, but in English "pedo" is slang for a pedophile. A reviewer reading it that way could reject it under guideline 1.1 (objectionable content) or the name check, and an English speaker searching the store may read it the same way. |
| `Pedos: Fart Songs` | 17 | Recommended. The words after the colon say what the app is at a glance, which makes the slang reading much less likely, and puts "fart" and "songs" in the indexed name. |

Either way, App Store Connect will refuse a name another app already uses; check that it's free
when you create or rename the app record.

**Owner decides:** which name, and the first App Store version number (see below).

## Subtitle (30 characters max)

```text
Turn your farts into songs
```

26 characters. The name and subtitle are indexed for search, so the keywords below don't repeat
"fart", "songs" or "Pedos".

**If the name is `Pedos: Fart Songs`**, this subtitle repeats "fart" and "songs" and wastes 26
characters on words the name already indexes. Use this one instead:

```text
Find the melody in every toot
```

29 characters. It adds "melody" and "toot", so for this pairing use the second keyword list below,
which drops those two words and adds "laugh" and "gross".

## Promotional text (170 characters max)

```text
Record a fart and Pedos finds its note. Collect notes to unlock songs like Twinkle, Twinkle and Ode to Joy, then hear them played only by your farts.
```

149 characters. Promotional text can be changed at any time without a new build.

## Description (4,000 characters max)

```text
Pedos turns your farts into music.

Record a fart and Pedos finds its note. Some farts hold a steady pitch, like G3 or A♯2. Others are just noise. Every fart is saved, and every one with a clear note joins your collection.

Collect enough different notes and songs unlock, like Mary Had a Little Lamb, Twinkle, Twinkle, Little Star, Ode to Joy and Jingle Bells. A song needs a different fart for each of its notes, so finding new notes is the game.

Then Pedos plays the song with your farts and nothing else. No synthesizer, no instruments, no backing track: every sound you hear is one of your own recordings, moved to the note it plays. Keep the ones you like as Toots.

HOW IT WORKS
• Record: one big red button. One fart per recording.
• Your note: see the note each fart makes, or that it's noise-like.
• Recordings: play back every fart, with its note and waveform.
• Compose: see how close each song is to unlocking, and which notes it still needs.
• Song Creator: hear a song played by your farts, see which fart plays which note, and tap any note to hear it alone.
• Toots: everything you've made, ready to play, rename or delete.
• Profile: your recordings, notes collected, songs unlocked and Toots.

SONGS WITH SOURCES
Every song comes from a public-domain score in the PDMX dataset.

PRIVATE BY DESIGN
Your recordings stay on your iPhone. There's no account, no sign-in, no ads and no tracking, and Pedos doesn't send your recordings anywhere.
```

1,484 characters.

Claims checked against the code and docs:

- "finds its note", "noise-like", "G3 or A♯2": Recording Analysis (`RecordingAnalysisKit/`); the
  Result screen shows "Your note" or "No steady note this time".
- "a different fart for each of its notes": the unlock rule in `docs/design/app-map.md`.
- "nothing else", "no synthesizer": ADR 0004. **Only true once the Release build renders Toots
  from your Recordings (#17).**
- "Keep the ones you like as Toots", "ready to play, rename or delete": true in today's app, but
  Toots are kept in memory only and are lost when the app quits. **Toots must survive a relaunch
  before submission**, or this line must change.
- "public-domain score in the PDMX dataset": all 12 shipped Songs are from PDMX (ADR 0003,
  `catalog/catalog.json`; each Song shows "Public domain score · PDMX"). The one Mutopia entry,
  `ode-mutopia`, is in the catalog but doesn't ship, so Mutopia isn't credited. The Profile tab's
  credit line still names both; that wording is a separate small app change.
- "no account, no sign-in, no ads and no tracking", "doesn't send your recordings anywhere": see
  `app-privacy.md` (no network code in the app).
- No number of songs is given, because the Song Catalog is meant to grow (it has 12 today).

## Keywords (100 characters max)

Comma-separated, no spaces after commas.

```text
toot,music,melody,funny,sound,recorder,pitch,note,silly,humor,gas,poot,tune,noise,comedy,flatulence
```

99 characters. For the `Pedos: Fart Songs` name with the second subtitle, use this list instead
("melody", "toot" and "tune" are out; "laugh" and "gross" are in):

```text
music,funny,sound,recorder,pitch,note,silly,humor,gas,poot,noise,comedy,flatulence,laugh,gross
```

94 characters. Left out on purpose: "fart" and "songs" (already in the name and subtitle), "prank"
and "soundboard" (Pedos has no prank or soundboard feature), "tuner" (it isn't one), "kids"
(it suggests the Kids category, which has its own rules), and competitors' names (guideline 2.3.7).

## What's New (for the first update)

App Store Connect doesn't offer "What's New" for an app's first version, so this text isn't used at
launch. Keep it for the first update, and edit it to describe what changed.

**Version number (owner decides).** The build's version is `MARKETING_VERSION: "0.1.0"` in
`ios/project.yml`, which release-please manages, so the first App Store version won't be "1.0"
unless someone bumps it. The owner picks the number before the first upload.

```text
First release. Record your farts, find each one's note, and unlock songs played only by your farts.
```

99 characters (limit 4,000).

## Category

- **Primary:** Entertainment
- **Secondary:** Music

Entertainment fits a novelty app first; Music covers the melody side and is where someone looking
for "songs" browses.

## Copyright

```text
2026 <copyright holder>
```

Apple's format is the year followed by the person or entity that owns the rights, with no URL
(App Store Connect adds the ©). **Owner provides:** the legal name of the account holder (team
W3GXL2NQQP).

## Price

**Free**, with no in-app purchases. The Paid Apps agreement isn't needed.

## Review notes for Apple

```text
Pedos records short sounds, finds the musical note of each one, and plays well-known public-domain melodies using only those recordings as sound. It's made for farts, but you don't need one to review it: any short sound works.

How to try it:
1. On first launch, tap "Allow microphone" on the Welcome screen. The system microphone prompt appears then (or the first time you tap Record, if you chose "Not now").
2. On the Record tab (center), tap the red button, make a short sound, and tap Stop.
3. Tap Save. The Result screen shows the note it found ("Your note"), or "No steady note this time" for a sound without a clear pitch, such as a clap. Humming or whistling a steady note gives a clear one.
4. Each different note you record counts toward unlocking songs (Compose tab). For example, four separate recordings, each humming one steady note of "do, re, mi, sol", cover the four notes of Mary Had a Little Lamb.
5. Open an unlocked song in Compose to hear it played by your recordings, then Save to Toots.

Privacy: recordings stay on the device, in the app's own storage. There is no account or sign-in, and the app makes no network requests: nothing is collected, sent or tracked.

The melodies come from public-domain scores (the PDMX dataset); each song's source and license are recorded in the app's catalog.
```

**Owner checks before submitting:** step 4 follows from the unlock rule (one recording per
distinct pitch, within 3 semitones, under any transposition), and the analysis finds pitches from
about 45 to 900 Hz, which covers humming. Try it once on the final Release build so the note
promises exactly what a reviewer will see.

App Store Connect also asks for a review contact (name, phone, email); **the owner provides it.**
No demo account is needed (there's no sign-in).
