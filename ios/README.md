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
`scripts/generate-sample-data.py --check`, on every pull request that is ready for review (draft
PRs are skipped) and every push to `main`. It skips the dark-mode UI test runs, which exist for
screenshots.

## Sample data

Until the real recorder, store, analysis and rendering land, `SampleAppModel` drives the screens.
Recording is simulated: each take is the next Fixture Library Recording in the design prototype's
story order, with its reference analysis. Song Creator is simulated too: making a Toot of an
Unlocked Song returns the prototype's render of that Song (#17 renders it from your Recordings).
When you have every Recording that render used (always, with all 23), Song Creator shows the
render's own Recordings; otherwise it shows Pitch Coverage's matching and says the audio
doesn't follow it.

- `Pedos/Sample/SampleData.generated.swift` is generated from `docs/design/prototype/data.js` by
  `scripts/generate-sample-data.py`: the Songs with their pitches and notes, the Fixture
  Library's analysis, and (Debug only) which fixture plays each pitch in each Song's render.
  Rerun it when the prototype data changes; CI runs it with `--check`.
- Debug builds bundle the prototype's audio from `docs/design/prototype/audio/`: the trimmed
  fixtures (`rec-*.mp3`) and its render of each Song (`song-*.mp3`). Release builds exclude both,
  start empty, and can't record or make Toots; `scripts/check-bundle-identifiers.sh` builds
  Release and fails if the app contains any audio.
- Debug launch arguments set up states by hand (Xcode: Product > Scheme > Edit Scheme >
  Arguments), for example `-PedosSampleStart all` for all 23 Recordings,
  `-PedosSampleToots mary,ode` for two Toots, or `-PedosSampleFailure saveFailed`
  for an error state. `Pedos/Sample/SampleLaunchOptions.swift` lists them all.
- SwiftUI previews (Debug only) use `SampleAppModel.preview(…)` from
  `Pedos/Sample/SamplePreviews.swift`.

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

## TestFlight

[`.github/workflows/testflight.yml`](../.github/workflows/testflight.yml) uploads the Release app
to TestFlight on every push to `main`, and by hand from any branch (Actions > TestFlight > Run
workflow, or `gh workflow run testflight.yml --ref <branch>`), which is how a branch build reaches
the owner's phone and how a change to the pipeline is proven before merge. [`scripts/upload-testflight.sh`](scripts/upload-testflight.sh) does the work: it
archives unsigned, checks the archive (bundle identifier, build number, icon, no audio), signs it
with cloud signing, checks the signature, and uploads it.

- **Version:** `MARKETING_VERSION` in `project.yml`, which release-please bumps when its release PR
  merges. **Build number:** `<run number>.<attempt>` of the TestFlight workflow.
- **Setup (owner, once):** an App Store Connect app record for `com.serp.pedos`, an App Store
  Connect API key with the Admin role (cloud signing needs it), repository secrets `ASC_KEY_P8`
  (the `.p8` file), `ASC_KEY_ID` and `ASC_ISSUER_ID`, and the repository variable `APPLE_TEAM_ID`.
- **Release builds have no sample data**, so until the real recorder lands (#12), the TestFlight
  app shows empty tabs and can't record.
- `scripts/upload-testflight.sh --archive-only` (with `BUILD_NUMBER` set) builds and checks the
  archive locally without a key.
