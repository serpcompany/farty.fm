# Melody engine proof

Turns the approved Fixture Library Recordings into recognizable melodies, using only the Recordings' own audio.

`tools/` is one [uv](https://docs.astral.sh/uv/) project for this engine and the [catalog importer](../catalog/README.md): `tools/pyproject.toml` pins every dependency, `tools/uv.lock` locks them all, and the root `.python-version` pins Python 3.12.10, the version `fixtures/golden/index.json` records. On first use `uv run` creates a virtual environment under `tools/` and installs the project in editable mode, which puts `melody-lab/` and `catalog/` on the import path, so `import engine` works from both folders and with `python -I`. The same commands work on Windows, macOS and Linux, from `tools/melody-lab`:

```sh
uv run run_all.py          # quick check: renders every Song and prints the metrics
uv run build.py            # renders every Song into out/listen/ (index.html + audio); needs ffmpeg
uv run export_golden.py    # writes the reference results to ../../fixtures/golden/ for the web app
uv run pytest ..           # every unit test of the engine and the catalog importer
```

Then open `out/listen/index.html` in a browser. Inputs: `../../fixtures/recordings/` (Fixture Library) and `../../catalog/` (Song Catalog). CI runs the tests, exports the golden data and fails on any difference (`tools.yml`, [CI](../../docs/agents/ci.md)).

| File | Role |
| --- | --- |
| `melody.py` | MIDI → monophonic melody plan (sustain-aware skyline; reports everything dropped) |
| `engine.py` | Recording Analysis (single-gesture segment, pitch contour, self-audition, settle time), Melody Fit (Pitch Coverage, unlocks and Auto-map: key choice and one Recording per pitch, near enough in pitch and at least as long as the pitch's longest note at its own length, `NOTE_FILL`, ADR 0011), rendering each fart raw (ADR 0012) |
| `evaluate.py` | Reads each render back with pitch trackers. The bar (`BAR`, ADR 0012): notes within 50 cents of their fart's own pitch, onsets on time, and no re-attacks inside a note. Reported only: how far the notes sound from the melody, the contour score, how much of each note sounds, and how much of the sounding notes YIN hears on the melody's pitch |
| `build.py` | Renders all versions and writes the listening page (`listen/index.html` + data + audio) |
| `run_all.py` | Prints the checks for every Song, PASS or FAIL against the bar, and for a locked one the notes still needed and how long a fart each needs; the quickest regression check |
| `export_golden.py` | Writes the reference results (Recording Analysis, imported Songs, Arrangements, metrics) as deterministic JSON to `fixtures/golden/`; see its README |
| `evaluate_renders.py` | Runs `evaluate.py` on renders made elsewhere (default `out/web/`, from `apps/web`'s `pnpm exec tsx scripts/render-songs.ts`), prints run_all.py's line next to the golden metrics, and fails a render below ADR 0012's bar or worse than golden, and the run when the renders aren't exactly the golden unlocked Arrangements (missing, extra or stale); `--against-reference` also prints the largest sample difference from the reference's own render |
| `golden_cost.py` | Recomputes `plan()`'s cost for a given Arrangement from the golden data (how Auto-map tests check a tie-aware match); checks every golden Arrangement |
| `test_needed_seconds.py` | Checks that the length a locked Song says it needs (`needed_seconds()`) unlocks it, for a fart 3 semitones or an octave from each missing note, on the golden data |
| `plot_env.py` | Plots each Recording's loudness envelope with its detected gesture boundaries |

The render path is only: trim, cut at the note's end, fade, gain, mix. Every fart plays raw, at its own pitch and speed (ADR 0012). No resampling, oscillators, resonators, loops, or granular re-triggering. `variable_resample()` only reads a Recording back with its pitch held for Recording Analysis (audition and settle time); no Song plays it.
Each step maps to AVAudioEngine/Accelerate for the iOS port.
