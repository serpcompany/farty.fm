#!/bin/sh
# Builds the Release app (the App Store build) for the simulator and checks that it carries no
# internal content: no audio files at all (the Fixture Library) and no Fixture Library loader
# code. QA builds, which TestFlight gets until launch, carry both; Release must not (AGENTS.md).
# Release makes Toots only from the user's own Recordings.
#
# Run after `xcodegen generate`: ios/scripts/check-release-build.sh
set -eu

cd "$(dirname "$0")/.."
project=Pedos.xcodeproj
[ -d "$project" ] || { echo "error: $project not found; run xcodegen generate in ios/ first" >&2; exit 1; }

derived=$(mktemp -d "${TMPDIR:-/tmp}/pedos-release.XXXXXX")
trap 'rm -rf "$derived"' EXIT
echo "Building Release for the simulator..."
xcodebuild build -project "$project" -scheme Pedos -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO -quiet
app="$derived/Build/Products/Release-iphonesimulator/Pedos.app"
[ -x "$app/Pedos" ] || { echo "error: no Release app was built" >&2; exit 1; }

failures=0
audio=$(find "$app" -type f \( -iname '*.mp3' -o -iname '*.wav' -o -iname '*.m4a' \
  -o -iname '*.caf' -o -iname '*.aif' -o -iname '*.aiff' \) -exec basename {} \; | sort | tr '\n' ' ')
if [ -z "$audio" ]; then echo "ok    no audio files"; else echo "FAIL  audio files: $audio"; failures=$((failures + 1)); fi
loader=$(find "$app" -type f -perm -u+x -exec strings -a {} \; 2>/dev/null | grep -c -E 'FixtureLibrary|Load the Fixture Library' || true)
if [ "$loader" -eq 0 ]; then echo "ok    no Fixture Library loader code"; else echo "FAIL  $loader Fixture Library loader strings"; failures=$((failures + 1)); fi
[ "$failures" -eq 0 ] || exit 1
