# Pedos iPhone app

SwiftUI app for iOS 26+, portrait iPhone only. The Xcode project is generated from
[`project.yml`](project.yml) with [XcodeGen](https://github.com/yonaskolb/XcodeGen) and is not
committed.

## Builds

| Build | For | Recordings | Fixture Library | Bundle identifier |
| --- | --- | --- | --- | --- |
| **Debug** | development, previews, UI tests | sample data (`FixtureRecordingSource`), or real with `-PedosLive YES` | bundled, with "Load the Fixture Library" | `com.serp.pedos.debug` |
| **QA** | TestFlight until launch (internal testing only) | real | bundled, with "Load the Fixture Library" on the Profile tab | `com.serp.pedos` |
| **Release** | the App Store | real | none: no files, no loader code | `com.serp.pedos` |

Debug and QA compile with `INTERNAL`, which gates everything internal: the Fixture Library loader,
the sample data, and the "Simulated" notes. `scripts/check-release-build.sh` builds Release and
fails if it contains any audio or loader code.

## Songs and Toots

Every build makes real Toots from the user's own Recordings:

- **Pitch Coverage and Auto-map** come from `RecordingAnalysisKit.AutoMap`, the reference
  engine's `melody_fit()` in Swift (ADR 0004, ADR 0006): one Melodic Recording per distinct
  pitch, within 3 semitones or with an Octave Move. `CoverageResult` adapts it for the Compose
  tab, the locked-Song sheet, the Result screen and the Profile counts. Ties between equally good
  Arrangements break on each Recording's `uuidString`; Recordings loaded from the Fixture
  Library get ids ending in their fixture id (`UUID(fixtureID:)`), so they get the reference's
  golden Arrangements.
- **Song Creator** renders the Song with `RecordingAnalysisKit.Renderer` (`TootRenderer`), off the
  main actor, from each Recording's file cut at its stored analysis, and writes mono 44.1 kHz
  AAC. In the simulator a Toot takes under 0.1 s to make.
- **Saved Toots** are kept in `Application Support/Toots` (`TootStore`): `<id>.m4a`, the Toot's own
  copy of its audio, and `<id>.json` with its title, Song, date, length and Arrangement. Deleting a
  Recording the Toot used doesn't change how it sounds. Rename and delete write through to the
  store. The Debug sample model keeps Toots in a new temporary folder each launch.
- `PedosTests/TootRenderTests` measures the app's Toot files with the render checks
  (`RenderChecking`, `evaluate.py` in Swift, a test-only library the app doesn't link).
- `RecordingAnalysisKit` is optimized in Debug builds too (`Package.swift`); unoptimized, a
  Toot took seconds to make and the unit tests minutes.

## Generate

```sh
brew install xcodegen   # CI pins 2.44.1
cd ios
xcodegen generate       # writes Pedos.xcodeproj; rerun after adding or removing files
```

## Build and test

Any available iPhone simulator on iOS 26 or later works. List them, then pass one by its UDID:

```sh
xcrun simctl list devices available
cd ios
scripts/run-tests.sh quick <udid>   # what a pull request must pass (about 2 minutes locally)
scripts/run-tests.sh full <udid>    # every unit and UI test
scripts/check-bundle-identifiers.sh
```

The `Pedos` scheme runs the unit tests (`PedosTests`) and the UI tests (`PedosUITests`). The UI
tests for each screen run in light mode and again in dark mode (the `…DarkUITests` subclasses),
and attach a screenshot of every screen and state to the result bundle; export them with
`xcrun xcresulttool export attachments --path <result>.xcresult --output-path <dir>`.

`scripts/run-tests.sh` runs the tests on three simulators at once (CI uses one: its machine is too
small for more) and skips the dark-mode runs,
which exist for screenshots (set `TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY=0` to include them).

CI ([`.github/workflows/ios.yml`](../.github/workflows/ios.yml)) splits the tests the way Apple
recommends: a pull request that's ready for review runs the **quick** set, which gates the merge
(draft PRs are skipped). Every push to `main` runs the **full** set, which doesn't block anyone.
Both also run `scripts/generate-sample-data.py --check`, and a second job runs the bundle
identifier check and the Recording Analysis golden tests (`swift test` in `RecordingAnalysisKit/`)
at the same time.

### Testing the build that ships

Every other UI test runs the Debug build on sample data. `ShippedBuildSmokeTests` runs the real
loop instead: record, save, see the pitch, replay, relaunch, delete. The `PedosShipped` scheme
runs it on the **QA** build (what TestFlight gets), and the TestFlight workflow uploads only if it
passes:

```sh
xcodebuild test -project Pedos.xcodeproj -scheme PedosShipped \
  -destination 'platform=iOS Simulator,id=<udid>' \
  -only-testing:PedosUITests/ShippedBuildSmokeTests
```

It also records four farts, which unlock Mary Had a Little Lamb, and makes, saves and plays the
Toot.

Simulators in CI have no microphone, so the test launches the app with
`-PedosTestTake <file>[,<file>…]`, and each take is a copy of the next file: Fixture Library
Recordings 090, 084, 086 and 094 as the recorder writes them
(`PedosUITests/Resources/test-take-*.m4a`). Everything after the microphone is real. The real
microphone is checked by hand, on a phone, from a TestFlight build.

## Recording

`SampleAppModel` drives the screens, and a `RecordingSource` supplies the Recordings:

- **QA and Release builds record for real** (`LiveRecordingSource`): the microphone records mono 44.1 kHz
  AAC to a draft file, Save moves it into `Application Support/Recordings` (`RecordingStore`), and
  Recording Analysis runs after the save. Its result is kept next to the Recording
  (`<id>.analysis.json`) and runs again when the analysis version changes (ADR 0002). Replay plays
  just the fart the analysis found, without the dead air before or after it; the file is never cut.
  In QA builds, "Load the Fixture Library" (Profile tab) writes each of the 23 fixtures the way the
  recorder writes a take and saves it, so they're stored, analyzed and played like real farts.
  Loading again adds only the missing ones.
- **Debug builds use the Fixture Library** (`FixtureRecordingSource`) for the screens' UI tests and
  previews, unless launched with `-PedosLive YES`, which records for real as Release does.

## Sample data

In Debug builds, recording is simulated: each take is the next Fixture Library Recording in the
design prototype's story order: the fixture file itself, with the reference engine's analysis of
it. Song Creator is real: it renders each Toot from those files.

- `Pedos/Sample/SampleData.generated.swift` is generated by `scripts/generate-sample-data.py`
  from `docs/design/prototype/data.js` (the Songs and the story order) and `fixtures/golden/`
  (each Song's beats per bar, and each fixture's file and analysis). Rerun it when either
  changes; CI runs it with `--check`.
- Debug and QA builds bundle the Fixture Library (`fixtures/recordings/`); Release excludes it.
- Debug launch arguments set up states by hand (Xcode: Product > Scheme > Edit Scheme >
  Arguments), for example `-PedosSampleStart all` for all 23 Recordings, `-PedosSampleStart 8`
  for the first 8 story takes (7 Unlocked Songs), `-PedosSampleToots mary,ode` for two Toots
  made at launch, or `-PedosSampleFailure saveFailed` for an error state.
  `Pedos/Sample/SampleLaunchOptions.swift` lists them all.
- SwiftUI previews (Debug only) use `SampleAppModel.preview(…)` from
  `Pedos/Sample/SamplePreviews.swift`.

## Bundle identifiers

Per the SERP Apple app build identity standard, only Release and QA carry the product identifier:

| Build | Bundle identifier |
| --- | --- |
| Release and QA | `com.serp.pedos` |
| Debug (and the unit-test host) | `com.serp.pedos.debug` |
| Unit tests | `com.serp.pedos.tests` |
| UI tests | `com.serp.pedos.uitests` |

`PedosTests` checks the Debug host at run time; `scripts/check-bundle-identifiers.sh` checks every
configuration's build settings.

## TestFlight

**Stopped on 2026-10-06 (#103).** After the App Store rejection (ADR 0007), the owner ended TestFlight releases, and the workflow was removed. The rest of this section describes how it worked, for the record.

[`.github/workflows/testflight.yml`](../.github/workflows/testflight.yml) uploads the **QA** app
to TestFlight on every push to `main`, and by hand from any branch (Actions > TestFlight > Run
workflow, or `gh workflow run testflight.yml --ref <branch>`), which is how a branch build reaches
the owner's phone and how a change to the pipeline is proven before merge. [`scripts/upload-testflight.sh`](scripts/upload-testflight.sh) does the work: it
archives unsigned, checks the archive (bundle identifier, build number, icon, and its audio:
exactly the 23 fixtures for QA, none for Release), signs it with cloud
signing, checks the signature, and uploads it. QA builds are marked internal testing only
(`testFlightInternalTestingOnly`), so App Store Connect won't let them reach external testers or the
App Store. `CONFIGURATION=Release` uploads the App Store build instead, for the release (#23).

- **Version:** `MARKETING_VERSION` in `project.yml`, which release-please bumps when its release PR
  merges. **Build number:** `<run number>.<attempt>` of the TestFlight workflow.
- **Setup (owner, once):** an App Store Connect app record for `com.serp.pedos`, an App Store
  Connect API key with the Admin role (cloud signing needs it), repository secrets `ASC_KEY_P8`
  (the `.p8` file), `ASC_KEY_ID` and `ASC_ISSUER_ID`, and the repository variable `APPLE_TEAM_ID`.
- **Before uploading**, the workflow runs `ShippedBuildSmokeTests` on the QA build (see
  "Testing the build that ships") and uploads nothing if it fails.
- `scripts/upload-testflight.sh --archive-only` (with `BUILD_NUMBER` set) builds and checks the
  archive locally without a key.
