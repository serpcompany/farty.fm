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
| `analysis.py` | Recording Analysis: the fart, every burst of it, its first burst, which the pitch contour, Recording Pitch, self-audition and settle time read (ADR 0016), and its quiet lead-in (`lead_in_start()`, #287) |
| `engine.py` | Melody Fit (Pitch Coverage, unlocks and Auto-map: key choice and one Recording per pitch, near enough in pitch and at least as long as the pitch's longest note at its own length, `NOTE_FILL`, ADR 0011), any Recording placed on a note by ear (`placed()`, ADR 0015, ADR 0017), and rendering each fart raw (ADR 0012) |
| `trim.py` | A Trim: the fart found between a person's handles (`trim_bounds()`), and the same Recording playing only that part (`trimmed()`, ADR 0019) |
| `evaluate.py` | Reads each render back with pitch trackers. The bar (`BAR`, ADR 0012): notes within 50 cents of their fart's own pitch, onsets on time, and no re-attacks inside a note that its own fart doesn't have (ADR 0016). Reported only: the notes whose fart plays a second burst of its own, how far the notes sound from the melody, the contour score, how much of each note sounds, and how much of the sounding notes YIN hears on the melody's pitch |
| `build.py` | Renders all versions and writes the listening page (`listen/index.html` + data + audio) |
| `run_all.py` | Prints the checks for every Song, PASS or FAIL against the bar, and for a locked one the notes still needed and how long a fart each needs; the quickest regression check |
| `export_golden.py` | Writes the reference results (Recording Analysis, imported Songs, Arrangements, metrics) as deterministic JSON to `fixtures/golden/`, with LF line endings and UTF-8 on every OS; see its README |
| `evaluate_renders.py` | Runs `evaluate.py` on renders made elsewhere (default `out/web/`, from `apps/web`'s `pnpm exec tsx scripts/render-songs.ts`), prints run_all.py's line next to the golden metrics, and fails a render below ADR 0012's bar or worse than golden, and the run when the renders aren't exactly the golden unlocked Arrangements (missing, extra or stale); `--against-reference` also prints the largest sample difference from the reference's own render. `--scenario scenarios/<id>.json` checks the renders of a Scenario instead (`render-songs.ts --scenario`, into `out/web-<id>/`), with its own library, Placed Pitches and Trims, against the bar and the reference's Arrangements for it |
| `scenarios/` | Scenarios: a library of fixtures, with Placed Pitches and Trims (`trim_bounds()`, then `trimmed()`), for `render-songs.ts --scenario` and `evaluate_renders.py --scenario`. `trim-065.json` is ADR 0019's measurement, `review-melodic.json` #314's |
| `golden_cost.py` | Recomputes `plan()`'s cost for a given Arrangement from the golden data (how Auto-map tests check a tie-aware match); checks every golden Arrangement |
| `plot_env.py` | Plots each Recording's loudness envelope with its detected fart boundaries and first-burst end |
| `test_*.py` | Unit tests: Recording Analysis on synthetic tones and two fixtures, the costs, Melody Fit, `plan()` and `render()` on synthetic Recordings, the importer on generated MIDI, where a score's bars start, `evaluate.py`, the golden writer, and the golden data itself. What each checks, and why its cases are what they are, is in [The tests](tests.md) |
| `golden_inputs.py`, `signals.py` | The tests' golden Recordings and Songs, and synthetic signals |

The render path is only: trim the silence around the fart (or cut at its Trim, ADR 0019), cut at the note's end, fade, gain, mix. A fart's second burst plays too (ADR 0016), and its quiet lead-in plays before the beat when the rest before the note has room (#287). Every fart plays raw, at its own pitch and speed (ADR 0012). No resampling, oscillators, resonators, loops, or granular re-triggering. `variable_resample()` only reads a Recording back with its pitch held for Recording Analysis (audition and settle time); no Song plays it. That read-back stayed as it was when Songs began playing farts raw, so the Melodic Recordings and Auto-map's picks did too.

## Why the numbers are what they are

The thresholds and costs, how each was chosen, and what the web's port matches are in [Why the numbers are what they are](numbers.md).
