# AI Song Creator candidates (#21)

Three ways for AI Song Creator to write a new melody that only the user's Melodic Recordings can play, rendered by the melody lab engine and put on a listening page so the owner can choose by ear.

```sh
# once: the melody lab venv (see ../melody-lab/README.md) and the on-device model CLI
swift build -c release --package-path fm-compose
../melody-lab/.venv/bin/python build.py            # renders into out/listen/ (index.html, data.js, audio/)
../melody-lab/.venv/bin/python build.py --recheck  # also asks the model again and counts identical answers
cd out/listen && python3 -m http.server 8765       # then open http://127.0.0.1:8765
```

Model answers are cached in `out/cache/llm.json`; `--fresh` asks again. Candidates A and C need macOS 26 or later with Apple Intelligence turned on.

| File | Role |
| --- | --- |
| `common.py` | The palette: picks a key for the mood and gives each of its pitches its own Melodic Recording within 3 semitones (ADR 0004), in one octave. Also bar fitting, moving notes too short for their Recording, rendering and checks through `../melody-lab` |
| `rules.py` | **B**, rule-based: a seeded plan (motif rhythm, contour, cadence by mood) realized as two-bar question and answer phrases ending on the home note. `realize()` is shared with C |
| `llm.py` | **A**, the on-device model writes the notes as 8 eighth-note slots per bar, constrained to the palette's pitch names. **C**, the model fills in the plan from menus and `rules.realize()` writes the notes |
| `fm-compose/` | Swift CLI: JSON requests in, FoundationModels guided generation (`DynamicGenerationSchema`, seeded top-k sampling) out |
| `build.py` | Composes 10 melodies per candidate for each of two libraries (all 9 Melodic Recordings; only 021, 090, 094), renders them, runs `evaluate.py` and writes the page |
| `listen/index.html` | The listening page template |

Rendering uses only `engine.render(tune=1.0)`: trim, resample, fade, gain, mix.
