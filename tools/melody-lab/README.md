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
| `melody.py` | MIDI → monophonic melody plan (sustain-aware skyline; reports everything dropped) |
| `engine.py` | Recording Analysis (single-gesture segment, pitch contour, self-audition), Melody Fit (Pitch Coverage, unlocks and Auto-map: key choice and one Recording per pitch), rendering |
| `evaluate.py` | Reads each render back with a pitch tracker: notes on pitch, onsets on time, re-attacks inside a note |
| `build.py` | Renders all versions and writes the listening page (`listen/index.html` + data + audio) |
| `run_all.py` | Prints the checks for every Song; the quickest regression check |
| `export_golden.py` | Writes the reference results (Recording Analysis, imported Songs, Arrangements, metrics) as deterministic JSON to `fixtures/golden/`; see its README |
| `golden_cost.py` | Recomputes `plan()`'s cost for a given Arrangement from the golden data (how Auto-map tests check a tie-aware match); checks every golden Arrangement |
| `plot_env.py` | Plots each Recording's loudness envelope with its detected gesture boundaries |

The render path is only: trim, variable-rate resample, fade, gain, mix. No oscillators, resonators, loops, or granular re-triggering.
Each step maps to AVAudioEngine/Accelerate for the iOS port.
