# Melody engine proof

Turns the approved Fixture Library Recordings into recognizable melodies, using only the Recordings' own audio.

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python run_all.py        # quick check: renders every Song and prints the metrics
.venv/bin/python build.py          # renders every Song/version into out/listen/ (index.html + audio)
.venv/bin/python export_golden.py  # writes the reference results to ../../fixtures/golden/ for the Swift port
open out/listen/index.html
```

Inputs: `../../fixtures/recordings/` (Fixture Library) and `../../catalog/` (Song Catalog).

| File | Role |
| --- | --- |
| `melody.py` | MIDI → monophonic melody plan (sustain-aware skyline; reports everything dropped), and where the score's bars start (`bar_lines`, from its time signatures: a pickup isn't a bar) |
| `engine.py` | Recording Analysis (the fart, every burst of it, and its first burst, which the pitch contour, self-audition and settle time read, ADR 0016), Melody Fit (Pitch Coverage, unlocks and Auto-map: key choice and one Recording per pitch, near enough in pitch and at least as long as the pitch's longest note at its own length, `NOTE_FILL`, ADR 0011), rendering each fart raw (ADR 0012), and a Noise-like fart's Trim: the fart found between a person's handles (`trim_bounds()`), and the same Recording playing only that part (`trimmed()`, ADR 0019) |
| `evaluate.py` | Reads each render back with pitch trackers. The bar (`BAR`, ADR 0012): notes within 50 cents of their fart's own pitch, onsets on time, and no re-attacks inside a note that its own fart doesn't have (ADR 0016). Reported only: the notes whose fart plays a second burst of its own, how far the notes sound from the melody, the contour score, how much of each note sounds, and how much of the sounding notes YIN hears on the melody's pitch |
| `build.py` | Renders all versions and writes the listening page (`listen/index.html` + data + audio) |
| `run_all.py` | Prints the checks for every Song, PASS or FAIL against the bar, and for a locked one the notes still needed and how long a fart each needs; the quickest regression check |
| `export_golden.py` | Writes the reference results (Recording Analysis, imported Songs, Arrangements, metrics) as deterministic JSON to `fixtures/golden/`; see its README |
| `evaluate_renders.py` | Runs `evaluate.py` on renders made elsewhere (default `out/web/`, from `apps/web`'s `pnpm exec tsx scripts/render-songs.ts`), prints run_all.py's line next to the golden metrics, and fails a render below ADR 0012's bar or worse than golden, and the run when the renders aren't exactly the golden unlocked Arrangements (missing, extra or stale); `--against-reference` also prints the largest sample difference from the reference's own render. `--scenario scenarios/<id>.json` checks the renders of a Scenario instead (`render-songs.ts --scenario`, into `out/web-<id>/`), with its own library, Placed Pitches and Trims, against the reference's Arrangements for it |
| `golden_cost.py` | Recomputes `plan()`'s cost for a given Arrangement from the golden data (how Auto-map tests check a tie-aware match); checks every golden Arrangement |
| `test_needed_seconds.py` | Checks that the length a locked Song says it needs (`needed_seconds()`) unlocks it, for a fart 3 semitones or an octave from each missing note, on the golden data (`.venv/bin/python -I -m unittest discover -s . -p 'test_*.py'`) |
| `test_bar_lines.py` | Checks `bar_lines`: a pickup, a bar split at a repeat, meter changes, 6/8, and an excerpt's own beats (the same command) |
| `test_placed.py` | Checks a Noise-like Recording placed on a note by ear (`placed()`, ADR 0015): it counts as Melodic at that note, left out it changes nothing, a placement outlasts a Recording Pitch a later analysis finds (ADR 0017), and on the small library, Recording 065 placed on C2 unlocks two locked Songs (the same command) |
| `test_reattack.py` | Checks the re-attack bar (`added_reattacks()`, ADR 0016): a re-triggered fart is caught whether it has one burst or two, and a fart's own second burst alone isn't (the same command) |
| `test_lead_in.py` | Checks a fart's lead-in (`lead_in_start()`, #287): the sound joined to the attack, never room noise before a longer gap and at most 0.25 s; it plays before the beat in the rest before its note, never in the gap after the note before nor before the Song's start, the attack lands on the beat and the level is still set from it, notes written out of start order place the same, and a fart played past its written end holds back the next lead-in; and `009` placed on G3 plays its G3 opening before its beat, in When the Saints too (the same command) |
| `test_export_golden.py` | Checks that `export_golden.py` refuses a Song whose notes don't start in strictly increasing order, since it pairs `render()`'s events (in start order) with the notes by position (the same command) |
| `test_trim.py` | Checks a Trim (`trim_bounds()`, `trimmed()`, ADR 0019): it is the fart between the handles and always lies within them, Songs play only that part and Melody Fit counts its length, its pitch isn't read again, and only a Noise-like Recording, or one placed by ear, is trimmed (ADR 0017); on synthetic bursts, the golden data and Recording 065 (the same command) |
| `scenarios/` | Scenarios: a library of fixtures, with Placed Pitches and Trims, for `render-songs.ts --scenario` and `evaluate_renders.py --scenario`. `trim-065.json` is ADR 0019's measurement |
| `plot_env.py` | Plots each Recording's loudness envelope with its detected gesture boundaries and first-burst end |

The render path is only: trim the silence around the fart (or cut at its Trim, ADR 0019), cut at the note's end, fade, gain, mix. A fart's second burst plays too (ADR 0016), and its quiet lead-in plays before the beat when the rest before the note has room (#287). Every fart plays raw, at its own pitch and speed (ADR 0012). No resampling, oscillators, resonators, loops, or granular re-triggering. `variable_resample()` only reads a Recording back with its pitch held for Recording Analysis (audition and settle time); no Song plays it.
Each step maps to AVAudioEngine/Accelerate for the iOS port.
