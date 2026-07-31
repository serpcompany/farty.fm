# RecordingAnalysisKit corpus verification

This is technical evidence for
[Choose a post-save Recording Analysis approach](https://github.com/serpcompany/pedos-app/issues/4).
It does not require subjective listening review.

The reusable API is:

```swift
let result = try RecordingFileAnalyzer.analyze(url: recordingURL)
```

It returns:

- complete Recording duration in seconds;
- optional detected sound start/end in seconds, without modifying the file;
- RMS and peak level in dBFS plus a windowed RMS envelope;
- frame-level YIN pitch evidence, an explicit `available` or `unavailable`
  status, and an optional aggregate frequency/MIDI-note estimate.

## Automated verification

- Five controlled checks pass: duration, sound boundaries, RMS/peak dBFS,
  110 Hz pitch recovery, and unavailable pitch for silence.
- The Swift package builds for a generic iOS 17+ device target with Xcode 26.
- The same API decoded and analyzed all 23 approved Fixture Library
  Recordings with zero failures.
- All 23 detected sound-bound results stayed within their Recording duration.
- Pitch was available for 7 Recordings and explicitly unavailable for 16.
  This split is algorithm output, not ground truth or a quality score.

The machine-readable corpus result is in
`recording-analysis-library.json`. It contains no key, brightness, timbre
label, or other unapproved descriptor.
