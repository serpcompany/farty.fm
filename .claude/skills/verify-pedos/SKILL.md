---
name: verify-pedos
description: Prove a Pedos iPhone app feature works in the real app - build the Debug app, launch it on a dedicated iOS simulator, check it is this worktree's build, drive the feature through its XCUITest, and keep the screenshots and result bundle under tmp/agent/verify/. Use before claiming an iOS change (ios/, RecordingAnalysisKit/, fixtures/) works, or when asked to prove, run or screenshot a Pedos iPhone feature. Not for the web app (apps/web/, which has its own Playwright tests).
---

# Verify Pedos (iPhone app)

The app is SwiftUI, iOS 26+, portrait iPhone, generated with XcodeGen from `ios/project.yml`
(see `ios/README.md`). The harness is XCUITest (`ios/PedosUITests`): each feature is driven by an
existing UI test that taps the real screens and attaches screenshots to the result bundle. The
feature map is [`features.md`](features.md).

Run every step from the repository root. Shell variables don't survive between an agent's
commands, so the run's values live in `tmp/agent/verify-pedos.env`, and every step starts by
sourcing it. Send xcodebuild output to a log, and print only the exit code, the errors and the
summary.

## Isolation

- **Simulator:** each run creates its own simulator and passes it by UDID. Never boot, erase or
  delete a simulator this run didn't create, and don't open the Simulator app: everything here
  runs headless.
- **Build output:** `-derivedDataPath ios/tmp/DerivedData`, ignored by the `DerivedData/` rule
  in `.gitignore`. It's kept between runs, so later builds are incremental.
- **Data:** the app's Recordings and Toots live inside the run's simulator, so they go when it's
  deleted. Debug sample data never touches disk outside a temporary folder.
- **Tests run serially** (`-parallel-testing-enabled NO`). `scripts/run-tests.sh` clones the
  simulator three times and has no way to run one test or set the DerivedData path, so this skill
  calls `xcodebuild` with the same flags instead.

## 1. Launch

Set up the run, with one feature id from `features.md` (here `record`):

```sh
git check-ignore -q tmp/agent/ || echo 'tmp/agent/' >> "$(git rev-parse --git-common-dir)/info/exclude"
mkdir -p tmp/agent/logs
RUN=$(date +%Y%m%d-%H%M%S)-record
UDID=$(xcrun simctl create "verify-pedos-$RUN" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-5)
printf 'RUN=%s\nUDID=%s\nOUT=%s\nSTART=%s\n' "$RUN" "$UDID" "$PWD/tmp/agent/verify/$RUN" "$(date +%s)" > tmp/agent/verify-pedos.env
mkdir -p "tmp/agent/verify/$RUN" && cat tmp/agent/verify-pedos.env
```

iPhone 17 Pro on iOS 26.5 is what CI uses. If that runtime is missing, pick any iOS 26 or later
runtime from `xcrun simctl list runtimes available`.

Boot it, generate the project and build the app and its tests:

```sh
. tmp/agent/verify-pedos.env
xcrun simctl boot "$UDID" && xcrun simctl bootstatus "$UDID" -b > /dev/null && echo "booted $UDID"
(cd ios && xcodegen generate --quiet)
xcodebuild build-for-testing -project ios/Pedos.xcodeproj -scheme Pedos \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath ios/tmp/DerivedData \
  > tmp/agent/logs/build.log 2>&1; echo "build exit $?"
grep -n -B2 -A4 ' error: ' tmp/agent/logs/build.log | head -40; tail -2 tmp/agent/logs/build.log
```

XcodeGen comes from `brew install xcodegen` (CI pins 2.44.1). A cold build took about 20 s on an
Apple-silicon Mac, a few seconds when nothing changed; the ready signal is
`** TEST BUILD SUCCEEDED **` and exit 0.

Install and start the app (the Debug build, on sample data, past the Welcome sheet):

```sh
. tmp/agent/verify-pedos.env
xcrun simctl install "$UDID" ios/tmp/DerivedData/Build/Products/Debug-iphonesimulator/Pedos.app
xcrun simctl launch --terminate-running-process "$UDID" com.serp.pedos.debug -welcomeSeen YES
```

Ready: `simctl launch` prints `com.serp.pedos.debug: <pid>`. Teardown is step 5.

## 2. Doctor

A read-only check that the simulator runs this worktree's build and the app is up:

```sh
. tmp/agent/verify-pedos.env
BUILT=ios/tmp/DerivedData/Build/Products/Debug-iphonesimulator/Pedos.app
APP=$(xcrun simctl get_app_container "$UDID" com.serp.pedos.debug app)
cmp -s "$APP/Pedos.debug.dylib" "$BUILT/Pedos.debug.dylib" && echo "build: this worktree's" || echo "build: NOT this worktree's"
plutil -extract CFBundleIdentifier raw "$APP/Info.plist"
sleep 3; xcrun simctl spawn "$UDID" launchctl list | grep 'UIKitApplication:com.serp.pedos.debug' > /dev/null && echo "app: running" || echo "app: NOT running"
xcrun simctl io "$UDID" screenshot "$OUT/doctor.png" > /dev/null 2>&1 && echo "screenshot $OUT/doctor.png"
```

Healthy is `build: this worktree's`, `com.serp.pedos.debug` and `app: running`; `doctor.png`
shows the Record tab. Anything else: rebuild and reinstall (step 1) before driving.

## 3. Drive

Run the feature's UI test from `features.md`, which launches the app and taps through the real
screens. For `record`:

```sh
. tmp/agent/verify-pedos.env
TEST=PedosUITests/ShippedBuildSmokeTests/testRecordSaveHearThePitchReplayRelaunchAndDelete
TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY=1 xcodebuild test-without-building -project ios/Pedos.xcodeproj -scheme Pedos \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath ios/tmp/DerivedData \
  -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 360 \
  -resultBundlePath "$OUT/Pedos.xcresult" "-only-testing:$TEST" \
  > tmp/agent/logs/drive.log 2>&1; echo "drive exit $?"
grep -n -B2 -A4 -E ' error: |failed \(' tmp/agent/logs/drive.log | head -40; grep -E '^\*\* TEST|Executed' tmp/agent/logs/drive.log | tail -3
```

Exit 0 and `** TEST EXECUTE SUCCEEDED **` mean the feature's end state was reached. On a
failure, the assertion message and line are in the grep output; the screenshots up to the
failure are still in the result bundle.

Only the simulator's microphone is replaced: the Debug app with `-PedosLive YES` records for real
(`LiveRecordingSource`), and `-PedosTestTake` makes each take a copy of a Fixture Library file,
because a simulator can't hear a fart. Everything after the microphone (store, Recording
Analysis, playback, relaunch) is the shipping code. Tests on sample data (`PedosUITestCase`) use
the Debug sample model instead; `features.md` says which each feature uses.

## 4. Proof

Export the screenshots the test attached and the pass/fail summary:

```sh
. tmp/agent/verify-pedos.env
xcrun xcresulttool export attachments --path "$OUT/Pedos.xcresult" --output-path "$OUT/screenshots" > /dev/null
xcrun xcresulttool get test-results summary --path "$OUT/Pedos.xcresult" --compact > "$OUT/summary.json"
jq -r '"\(.result): \(.passedTests) passed, \(.failedTests) failed"' "$OUT/summary.json"
jq -r '.[].attachments[] | [.exportedFileName, .suggestedHumanReadableName] | @tsv' "$OUT/screenshots/manifest.json" |
  while IFS="$(printf '\t')" read -r file name; do
    mv "$OUT/screenshots/$file" "$OUT/screenshots/$(echo "$name" | sed -E 's/_[0-9]+_[0-9A-F-]+\.png$/.png/')"
  done
ls "$OUT/screenshots"
```

The export names files by UUID; the loop renames each to the name the test gave it, such as
`Result.png`. The proof for a run is `tmp/agent/verify/<run>/`: `doctor.png` (the build is up),
`screenshots/` (each named for the action and the state it shows), `summary.json`, and
`Pedos.xcresult` (open it in Xcode for the full timeline). Look at the
screenshots that show the end state named in `features.md` before reporting; in a PR, attach
them and name the feature and test.

## 5. Cleanup

Stop and delete only this run's simulator. Keep `tmp/agent/verify/` and the DerivedData.

```sh
. tmp/agent/verify-pedos.env
xcrun simctl shutdown "$UDID"; xcrun simctl delete "$UDID" && echo "deleted $UDID"
echo "run took $(( $(date +%s) - START ))s"; rm tmp/agent/verify-pedos.env
ls "$OUT" "$OUT/screenshots" | head -20
```

The last line checks the proof is still on disk. If a run failed part-way, run this step before
the next try, so no simulator is left behind (`xcrun simctl list devices | grep verify-pedos-`
lists any).
