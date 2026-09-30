# Pedos screen prototype

A grayscale, clickable prototype of every MVP screen, for structure approval in #47. The real audio comes from the Fixture Library through the melody lab.

The native app in `ios/` now implements this design, and later changes (Toots, five tabs, Profile) are recorded in `app-map.md` and `screens.md`, not here. Keep this folder: `data.js` and `audio/` are the source of the Debug sample data (`ios/scripts/generate-sample-data.py`).

- **Run it:** open `index.html` through any local web server, for example `python3 -m http.server` in this folder.
- **Rebuild the data and audio:** run `tools/melody-lab/build.py`, then run `tools/melody-lab/.venv/bin/python docs/design/prototype/build_data.py` from the repo root.
- **Evaluator panel:** switches the starting state (new user, 3 Recordings, all 23) and states the unlock rule.
- **Audio is a stand-in.** Song audio comes from the full-library renders, made before the 3-semitone rule (some shifts go up to about 8 semitones). Regenerate once after #43 updates the reference planner.
