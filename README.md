# Pedos

Turns fart Recordings into recognizable melodies, using only the Recordings themselves as sound.

**Pedos is becoming a web app** (`apps/web/`, ADR 0007). Apple rejected the App Store submission because it won't accept fart apps (#75). The web app is being built slice by slice (#94). The iPhone app below is no longer built or released: TestFlight releases stopped on 2026-10-06 (#103).

- **Plan:** the pinned [MVP roadmap](https://github.com/serpcompany/pedos-app/issues/45) issue, in build order.
- **Vocabulary:** [`CONTEXT.md`](CONTEXT.md). **Decisions:** [`docs/adr/`](docs/adr/).

## Where it stands

**v0.1.0 was a proof of concept** on sample data. Since then, the app records for real: TestFlight builds record your farts, save them, and find each one's pitch with Recording Analysis ported to Swift (`RecordingAnalysisKit/`, which matches the reference engine on all 23 Fixture Library Recordings). Debug builds still use the Fixture Library for the screens' UI tests.

| Works now | Still simulated |
| --- | --- |
| Five tabs: Recordings · Compose · **Record** · Toots · Profile. The app opens on Record and comes back to it. | Rendering: a Toot plays the design prototype's render of that Song (Debug builds only; TestFlight builds can't make Toots yet) |
| Record, Review and Result, with full-screen recording and every error state: real recording, saving and Recording Pitch | |
| Recordings with pitch, waveform and playback, kept across relaunch | |
| Compose: the Song Catalog with Pitch Coverage progress, unlocking at one Recording per note within 3 semitones | |
| Song Creator and Toots: note view, the Recordings used, tap a note or a Recording to hear it, save, rename, delete | |
| Profile: your stats | |

The melody engine itself is proven in Python (`tools/melody-lab/`). Next comes porting the rest of it (the Song Catalog, Auto-map and rendering) to Swift; the roadmap issue has the order.

## Run it

- **Web app:** `cd apps/web && pnpm install && pnpm dev`; see [`apps/web/AGENTS.md`](apps/web/AGENTS.md).
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
| `RecordingAnalysisKit/` | Recording Analysis in Swift (trimming, Recording Pitch, audition), tested against `fixtures/golden/` |
| `tools/melody-lab/` | Python reference melody engine and listening page |
| `docs/adr/` | Architecture decisions |
| `docs/design/` | App map, screen inventory and the approved clickable prototype |
| `docs/evidence/` | Screenshots attached to each merged screen PR |
| `docs/agents/` | How agents pick issues and follow the git workflow |

Earlier attempts are archived as `archive/*` git tags.
