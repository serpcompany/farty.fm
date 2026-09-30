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
test attaches a screenshot of each tab to the result bundle; export them with
`xcrun xcresulttool export attachments --path <result>.xcresult --output-path <dir>`.

CI ([`.github/workflows/ios.yml`](../.github/workflows/ios.yml)) runs the same steps on every pull
request and every push to `main`.

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
