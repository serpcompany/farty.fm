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
# Tests run on TEST_WORKERS clones of the simulator at once (3 by default; CI uses 1 because
# its machine is too small for clones). Run after `xcodegen generate`:
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
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 120
workers=${TEST_WORKERS:-3}
if [ "$workers" -gt 1 ]; then
  set -- "$@" -parallel-testing-enabled YES -parallel-testing-worker-count "$workers"
else
  set -- "$@" -parallel-testing-enabled NO
fi
if [ -n "$result" ]; then set -- "$@" -resultBundlePath "$result"; fi
for test in $only; do set -- "$@" "$test"; done
xcodebuild test "$@"
