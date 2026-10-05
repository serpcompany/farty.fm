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
scripts/run-tests.sh quick <udid>   # what a pull request must pass, about 5 minutes
scripts/run-tests.sh full <udid>    # every unit and UI test
scripts/check-bundle-identifiers.sh
```

The `Pedos` scheme runs the unit tests (`PedosTests`) and the UI tests (`PedosUITests`). The UI
tests for each screen run in light mode and again in dark mode (the `…DarkUITests` subclasses),
and attach a screenshot of every screen and state to the result bundle; export them with
`xcrun xcresulttool export attachments --path <result>.xcresult --output-path <dir>`.

`scripts/run-tests.sh` runs the UI tests on three simulators at once and skips the dark-mode runs,
which exist for screenshots (set `TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY=0` to include them).

CI ([`.github/workflows/ios.yml`](../.github/workflows/ios.yml)) splits the tests the way Apple
recommends: a pull request that's ready for review runs the **quick** set, which gates the merge
(draft PRs are skipped). Every push to `main` runs the **full** set, which doesn't block anyone.
Both also run `scripts/generate-sample-data.py --check`, the bundle identifier check and the
Recording Analysis golden tests (`swift test` in `RecordingAnalysisKit/`).

### Testing the build that ships

Every other UI test runs the Debug build on sample data. `ShippedBuildSmokeTests` runs the real
loop instead: record, save, see the pitch, replay, relaunch, delete. The `PedosShipped` scheme
runs it on the **Release** build, and the TestFlight workflow uploads only if it passes:

```sh
xcodebuild test -project Pedos.xcodeproj -scheme PedosShipped \
  -destination 'platform=iOS Simulator,id=<udid>' \
  -only-testing:PedosUITests/ShippedBuildSmokeTests
```

Simulators in CI have no microphone, so the test launches the app with `-PedosTestTake <file>`,
and each take is a copy of that file: Fixture Library Recording 090 as the recorder writes it
(`PedosUITests/Resources/test-take-090.m4a`). Everything after the microphone is real. The real
microphone is checked by hand, on a phone, from a TestFlight build.

## Recording

`SampleAppModel` drives the screens, and a `RecordingSource` supplies the Recordings:

- **Release builds record for real** (`LiveRecordingSource`): the microphone records mono 44.1 kHz
  AAC to a draft file, Save moves it into `Application Support/Recordings` (`RecordingStore`), and
  Recording Analysis runs after the save. Its result is kept next to the Recording
  (`<id>.analysis.json`) and runs again when the analysis version changes (ADR 0002). Replay plays
  just the fart the analysis found, without the dead air before or after it; the file is never cut.
- **Debug builds use the Fixture Library** (`FixtureRecordingSource`) for the screens' UI tests and
  previews, unless launched with `-PedosLive YES`, which records for real as Release does.

## Sample data

In Debug builds, recording is simulated: each take is the next Fixture Library Recording in the
design prototype's story order, with its reference analysis. Song Creator is simulated too: making a Toot of an
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
  so they can't make Toots until rendering (#17). `scripts/check-bundle-identifiers.sh` checks
  that Release excludes both, and `scripts/upload-testflight.sh` fails if an archive contains any audio.
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
- **Before uploading**, the workflow runs `ShippedBuildSmokeTests` on the Release build (see
  "Testing the build that ships") and uploads nothing if it fails.
- `scripts/upload-testflight.sh --archive-only` (with `BUILD_NUMBER` set) builds and checks the
  archive locally without a key.
