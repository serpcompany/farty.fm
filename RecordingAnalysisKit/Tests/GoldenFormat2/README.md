# Golden data, format 2 (frozen)

Swift is frozen at golden format 2. Format 3 added the settle time and its cost (#116), and then the pitch contour that keeps the attack (#208), to the reference engine and the web app. The iPhone app isn't being resubmitted (#106), so Swift got neither.

These files are `fixtures/golden/` as it was at format 2 (commit 56fd114). Don't edit them by hand, and don't re-export them:

- `index.json`
- `coverage.json`
- `recordings/`
- `arrangements/`
- `songs/`, the Songs those Arrangements were planned from. #225 imported Happy Birthday and We Wish You a Merry Christmas again from other scores, so `fixtures/golden/songs/` no longer matches them.

What reads them:

- `RecordingAnalysisKitTests/GoldenData.swift` (`Golden.index`, `Golden.recordings`, `Golden.arrangement`, `Golden.song`), so every Swift Recording Analysis, Auto-map and renderer test.
- `RecordingAnalysisKitTests/AutoMapTests.swift` reads `index.json`, `coverage.json`, `arrangements/` and `songs/` directly.
- `ios/PedosTests/PitchCoverageTests.swift` reads `arrangements/`.
- `ios/scripts/generate-sample-data.py` reads `recordings/` and `songs/`.

`recordings/` is commit 56fd114's, which has no `settle_s`. The near-threshold notes these files carry are in `fixtures/golden/README.md` as of that commit, for example the `saints` tolerance edge in `RendererTests.swift`.

If Swift ever gets the settle cost and the new contour, point these back at `fixtures/golden/` and delete this folder.
