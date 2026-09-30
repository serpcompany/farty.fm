# Pedos iPhone app

SwiftUI app for iOS 26+, portrait iPhone only. The Xcode project is generated from
[`project.yml`](project.yml) with [XcodeGen](https://github.com/yonaskolb/XcodeGen) and is not
committed.

## Generate

```sh
brew install xcodegen   # CI pins 2.44.1
cd ios
xcodegen generate       # writes Pedos.xcodeproj; rerun after adding or removing files
```

## Build and test

Any available iPhone simulator on iOS 26 or later works. List them, then pass one by its UDID
(or by its exact name):

```sh
xcrun simctl list devices available
cd ios
xcodebuild test -project Pedos.xcodeproj -scheme Pedos \
  -destination 'platform=iOS Simulator,id=<udid>'
scripts/check-bundle-identifiers.sh
```

The `Pedos` scheme runs the unit tests (`PedosTests`) and the UI tests (`PedosUITests`). The UI
tests for each screen run in light mode and again in dark mode (the `…DarkUITests` subclasses),
and attach a screenshot of every screen and state to the result bundle; export them with
`xcrun xcresulttool export attachments --path <result>.xcresult --output-path <dir>`.

CI ([`.github/workflows/ios.yml`](../.github/workflows/ios.yml)) runs the same steps, plus
`scripts/generate-sample-data.py --check`, on every pull request and every push to `main`. It
skips the dark-mode UI test runs, which exist for screenshots.

## Sample data

Until the real recorder, store and analysis land, `SampleAppModel` drives the screens. Recording
is simulated: each take is the next Fixture Library Recording in the design prototype's story
order, with its reference analysis.

- `Pedos/Sample/SampleData.generated.swift` is generated from `docs/design/prototype/data.js` by
  `scripts/generate-sample-data.py`. Rerun it when the prototype data changes; CI runs it with
  `--check`.
- Debug builds bundle the prototype's trimmed fixture audio (`docs/design/prototype/audio/rec-*.mp3`)
  for playback. Release builds exclude it and start empty; `scripts/check-bundle-identifiers.sh`
  builds Release and fails if the app contains any audio.
- Debug launch arguments set up states by hand (Xcode: Product > Scheme > Edit Scheme >
  Arguments), for example `-PedosSampleStart all` for all 23 Recordings or
  `-PedosSampleFailure saveFailed` for an error state. `Pedos/Sample/SampleLaunchOptions.swift`
  lists them all.

## Bundle identifiers

Per the SERP native app build identity standard, only Release carries the product identifier:

| Build | Bundle identifier |
| --- | --- |
| Release | `com.serp.pedos` |
| Debug (and the unit-test host) | `com.serp.pedos.debug` |
| Unit tests | `com.serp.pedos.tests` |
| UI tests | `com.serp.pedos.uitests` |

`PedosTests` checks the Debug host at run time; `scripts/check-bundle-identifiers.sh` checks every
configuration's build settings.
