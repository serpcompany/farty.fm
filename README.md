# Pedos

An iPhone app that turns fart Recordings into recognizable melodies, using only the Recordings themselves as sound.

- **Plan:** GitHub issues in the [TestFlight MVP milestone](https://github.com/serpcompany/pedos-app/milestones).
- **Vocabulary:** [`CONTEXT.md`](CONTEXT.md). **Decisions:** [`docs/adr/`](docs/adr/).

| Path | What it is |
| --- | --- |
| `catalog/` | Song Catalog: cited public-domain MIDI scores and their provenance |
| `fixtures/recordings/` | Fixture Library: 23 approved real fart Recordings (internal use only) |
| `tools/melody-lab/` | Python reference melody engine and listening page |
| `docs/` | ADRs, agent guidance, research evidence |

Hear the reference engine:

```sh
cd tools/melody-lab
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python build.py && open out/listen/index.html
```

Earlier attempts are archived as `archive/*` git tags.
