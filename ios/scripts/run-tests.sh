#!/bin/sh
# Runs one of the app's test sets, the way Apple recommends splitting them: a quick set that
# gates every pull request, and the full set after merge, which doesn't block anyone.
#
#   quick  the unit tests, the shipped-build test (record, save, pitch, replay, relaunch,
#          delete) and the core record-flow UI tests: what a pull request must not break
#   full   every unit and UI test
#
# The dark-mode UI test runs exist for screenshots, so they're skipped unless
# TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY=0.
#
# UI tests run on parallel clones of the simulator. Run after `xcodegen generate`:
#   ios/scripts/run-tests.sh quick|full <simulator UDID> [result bundle path]
set -eu

cd "$(dirname "$0")/.."
set_name=${1:?quick or full}
udid=${2:?simulator UDID}
result=${3:-}

case "$set_name" in
  quick)
    only="-only-testing:PedosTests
-only-testing:PedosUITests/ShippedBuildSmokeTests
-only-testing:PedosUITests/RecordFlowUITests
-only-testing:PedosUITests/AppTabsUITests" ;;
  full) only="" ;;
  *) echo "error: unknown test set '$set_name' (quick or full)" >&2; exit 1 ;;
esac

export TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY="${TEST_RUNNER_PEDOS_UI_TESTS_LIGHT_ONLY:-1}"

set -- \
  -project Pedos.xcodeproj \
  -scheme Pedos \
  -destination "platform=iOS Simulator,id=$udid" \
  -parallel-testing-enabled YES \
  -parallel-testing-worker-count "${TEST_WORKERS:-3}" \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 120
if [ -n "$result" ]; then set -- "$@" -resultBundlePath "$result"; fi
for test in $only; do set -- "$@" "$test"; done
xcodebuild test "$@"
