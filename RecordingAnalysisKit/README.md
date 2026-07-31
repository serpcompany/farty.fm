# RecordingAnalysisKit

Throwaway proof of the reusable local analysis boundary for a saved Recording.
It answers one programmatic question:

```swift
let result = try RecordingFileAnalyzer.analyze(url: recordingURL)
```

The result contains only the approved initial characteristics:

- full `durationSeconds`;
- optional detected `soundBounds` that never modify the Recording;
- `rmsDBFS`, `peakDBFS`, and a windowed amplitude `envelope`;
- optional reference pitch plus frame-level YIN periodicity evidence and
  explicit unavailable frames.

It does not assign a key, quality score, brightness, timbre label, or other
unproven descriptor. `periodicityEvidence` is algorithm evidence—not a
probability that the pitch is correct.

Run controlled verification:

```sh
swift test --package-path RecordingAnalysisKit
```

Run the same API over the approved Fixture Library:

```sh
zsh Tools/run-recording-analysis-library
```
