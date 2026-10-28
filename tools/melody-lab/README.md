# Melody engine proof

Turns the approved Fixture Library Recordings into recognizable melodies, using only the Recordings' own audio.

`tools/` is one [uv](https://docs.astral.sh/uv/) project for this engine and the [catalog importer](../catalog/README.md): `tools/pyproject.toml` pins every dependency, `tools/uv.lock` locks them all, and the root `.python-version` pins Python 3.12.10, the version `fixtures/golden/index.json` records. On first use `uv run` creates a virtual environment under `tools/` and installs the project in editable mode, which puts `melody-lab/` and `catalog/` on the import path, so `import engine` works from both folders and with `python -I`. The same commands work on Windows, macOS and Linux, from `tools/melody-lab`:

```sh
uv run run_all.py          # quick check: renders every Song and prints the metrics
uv run build.py            # renders every Song into out/listen/ (index.html + audio); needs ffmpeg
uv run export_golden.py    # writes the reference results to ../../fixtures/golden/ for the web app
uv run plot_env.py         # plots each Recording's level and gesture to out/envelopes.png
uv run pytest ..           # every unit test of the engine and the catalog importer
```

Then open `out/listen/index.html` in a browser. Inputs: `../../fixtures/recordings/` (Fixture Library) and `../../catalog/` (Song Catalog). CI runs the tests, exports the golden data and fails on any difference (`tools.yml`, [CI](../../docs/agents/ci.md)).

| File | Role |
| --- | --- |
| `melody.py` | MIDI → monophonic melody plan (sustain-aware skyline; reports everything dropped), and where the score's bars start (`bar_lines`, from its time signatures: a pickup isn't a bar) |
| `analysis.py` | Recording Analysis: the single-gesture segment, pitch contour, Recording Pitch, self-audition and settle time |
| `engine.py` | Melody Fit (Pitch Coverage, unlocks and Auto-map: key choice and one Recording per pitch, near enough in pitch and at least as long as the pitch's longest note at its own length, `NOTE_FILL`, ADR 0011), and rendering each fart raw (ADR 0012) |
| `evaluate.py` | Reads each render back with pitch trackers. The bar (`BAR`, ADR 0012): notes within 50 cents of their fart's own pitch, onsets on time, and no re-attacks inside a note. Reported only: how far the notes sound from the melody, the contour score, how much of each note sounds, and how much of the sounding notes YIN hears on the melody's pitch |
| `build.py` | Renders all versions and writes the listening page (`listen/index.html` + data + audio) |
| `run_all.py` | Prints the checks for every Song, PASS or FAIL against the bar, and for a locked one the notes still needed and how long a fart each needs; the quickest regression check |
| `export_golden.py` | Writes the reference results (Recording Analysis, imported Songs, Arrangements, metrics) as deterministic JSON to `fixtures/golden/`, with LF line endings and UTF-8 on every OS; see its README |
| `evaluate_renders.py` | Runs `evaluate.py` on renders made elsewhere (default `out/web/`, from `apps/web`'s `pnpm exec tsx scripts/render-songs.ts`), prints run_all.py's line next to the golden metrics, and fails a render below ADR 0012's bar or worse than golden, and the run when the renders aren't exactly the golden unlocked Arrangements (missing, extra or stale); `--against-reference` also prints the largest sample difference from the reference's own render |
| `golden_cost.py` | Recomputes `plan()`'s cost for a given Arrangement from the golden data (how Auto-map tests check a tie-aware match); checks every golden Arrangement |
| `plot_env.py` | Plots each Recording's loudness envelope with its detected gesture boundaries |
| `test_*.py` | Unit tests: Recording Analysis on synthetic tones and two fixtures, the costs, Melody Fit, `plan()` and `render()` on synthetic Recordings, the importer on generated MIDI, where a score's bars start (a pickup, a bar split at a repeat, meter changes, 6/8, and an excerpt's own beats), `evaluate.py`, the golden writer, and the golden data itself (every Arrangement, Song and fit). `test_needed_seconds.py` checks that the length a locked Song says it needs (`needed_seconds()`) unlocks it, for a fart 3 semitones or an octave from each missing note |
| `golden_inputs.py`, `signals.py` | The tests' golden Recordings and Songs, and synthetic signals |

The render path is only: trim, cut at the note's end, fade, gain, mix. Every fart plays raw, at its own pitch and speed (ADR 0012). No resampling, oscillators, resonators, loops, or granular re-triggering. `variable_resample()` only reads a Recording back with its pitch held for Recording Analysis (audition and settle time); no Song plays it. That read-back stayed as it was when Songs began playing farts raw, so the Melodic Recordings and Auto-map's picks did too.

## Why the numbers are what they are

- **The gesture** (`note_segment()`) starts 8 ms before the level first comes within 12 dB of its peak, so a slow swell doesn't make the note sound late. It ends at the first clear re-attack, so one note never holds a second audible "brrt": on a level smoothed over 50 ms, which removes the "brrrr" flutter above about 15 Hz, a dip of 6 dB below the running maximum and then a rise of 4 dB, after the first 60 ms. Otherwise it ends where the sound falls 30 dB below its peak. `evaluate.py` counts a re-attack inside a note the same way.
- **Pitch confidence** passes at 0.2, loose on purpose: the audition is the real gate (#208 raised it from 0.1).
- **The settle cost** (20 per note played wholly before its Recording settles, #92) was picked from 15, 20, 30, 40, 80 and 160, and per-second forms, by renders passing; 40 and above make a full-library Song worse.
- **The silence cost** (30 per second a Recording leaves silent, #205) was picked from 0, 10, 20, 30, 40, 60 and 80 on the 12 app Songs with the Fixture Library. Every value keeps all 12 passing with no Octave Moves, and 30 is the smallest that plays Happy Birthday's last half note in full (0.41 to 1.18 s). Above 30, sounding time gains little (90.0% to at most 93.2%) and single Songs lose on-pitch time.
- **`NOTE_FILL`** (1.0) and its sweep are in [ADR 0011](../../docs/adr/0011-unlocking-needs-farts-as-long-as-notes.md); the planner's moves, ranking and costs in [The reference planner](../../fixtures/golden/planner.md).
- **Bar lines** (`melody.bar_lines`): a bar is a pickup, not a bar, when it's shorter than the bar after it and either opens the score or completes a bar split at a repeat sign (3/4 and 1/4 before 4/4). PDMX's MIDI writes a pickup as its own short bar, and each half of a split bar as its own time signature, so the bar before the second half must be a whole time-signature segment: two whole 2/4 bars before 4/4 stay two bars.
- **The importer** keeps the highest note at each onset only when that note begins there: an inner voice starting under a held top note is dropped and counted, not allowed to chop the melody note. Engraving software exports notes slightly short of their written value, so a note's slot runs to the next onset unless a real rest follows: a gap of a full beat, or longer than the note itself.
