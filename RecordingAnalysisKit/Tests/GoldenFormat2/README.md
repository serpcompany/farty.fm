# Golden planner answers, format 2 (frozen)

The Swift Auto-map (`RecordingAnalysisKit.AutoMap`) is frozen at golden format 2 (#116). Format 3 added the settle time and its cost to the reference engine and to the web app. The iPhone app isn't being resubmitted (#106), so Swift didn't get them.

These files are `fixtures/golden/` as it was at format 2 (commit 56fd114). Don't edit them by hand, and don't re-export them:

- `index.json`
- `coverage.json`
- `arrangements/`

Two tests read them:

- `RecordingAnalysisKitTests/AutoMapTests.swift` reads all three. It reads `songs/` and `recordings/` from `fixtures/golden/`, which format 3 didn't change apart from adding `settle_s`, which Swift ignores.
- `ios/PedosTests/PitchCoverageTests.swift` reads `arrangements/`.

Everything else in Swift (Recording Analysis, the renderer) still reads `fixtures/golden/`.

If Swift ever gets the settle cost, point both tests back at `fixtures/golden/` and delete this folder.
