# Pedos

An iPhone app that turns fart Recordings into recognizable melodies, using only the Recordings themselves as sound.

- **Plan:** the pinned [MVP roadmap](https://github.com/serpcompany/pedos-app/issues/45) issue, in build order.
- **Vocabulary:** [`CONTEXT.md`](CONTEXT.md). **Decisions:** [`docs/adr/`](docs/adr/).

## Where it stands

**v0.1.0 is a proof of concept.** Every MVP screen is built in native SwiftUI, but runs on sample data:

| Works now | Still simulated |
| --- | --- |
| Five tabs: Recordings · Compose · **Record** · Toots · Profile. The app opens on Record and comes back to it. | Recording: each take is the next Fixture Library Recording |
| Record, Review and Result, with full-screen recording and every error state | Recording Analysis: the Recording Pitch comes from the reference results |
| Recordings with pitch, waveform and playback | Rendering: a Toot plays the design prototype's render of that Song |
| Compose: the Song Catalog with Pitch Coverage progress, unlocking at one Recording per note within 3 semitones | |
| Song Creator and Toots: note view, the Recordings used, tap a note or a Recording to hear it, save, rename, delete | |
| Profile: your stats | |

The melody engine itself is proven in Python (`tools/melody-lab/`). Next comes porting it to Swift behind real recording, then TestFlight; the roadmap issue has the order.

## Run it

- **iPhone app (Debug, simulator):** see [`ios/README.md`](ios/README.md). Launch with `-PedosSampleStart all` to start with all 23 sample Recordings.
- **Reference engine:** hear what the app will sound like:

  ```sh
  cd tools/melody-lab
  uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
  .venv/bin/python build.py && open out/listen/index.html
  ```

## Layout

| Path | What it is |
| --- | --- |
| `ios/` | The SwiftUI iPhone app (XcodeGen project, unit and UI tests) |
| `catalog/` | Song Catalog: cited public-domain scores and their provenance |
| `fixtures/recordings/` | Fixture Library: 23 approved real fart Recordings (internal use only) |
| `fixtures/golden/` | The reference engine's results, which the Swift port must match |
| `tools/melody-lab/` | Python reference melody engine and listening page |
| `docs/adr/` | Architecture decisions |
| `docs/design/` | App map, screen inventory and the approved clickable prototype |
| `docs/evidence/` | Screenshots attached to each merged screen PR |
| `docs/agents/` | How agents pick issues and follow the git workflow |

Earlier attempts are archived as `archive/*` git tags.
