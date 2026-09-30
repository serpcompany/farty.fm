#!/bin/sh
# Checks the SERP native app build identity for Pedos: only Release carries the
# product identifier, Debug and the test bundles have their own, and Info.plist
# takes the identifier from the build setting.
#
# It also builds Release for the simulator and checks that the app contains no
# audio: the Fixture Library's sample audio is for Debug builds only.
#
# Run after `xcodegen generate`: ios/scripts/check-bundle-identifiers.sh
set -eu

cd "$(dirname "$0")/.."
project=Pedos.xcodeproj
failures=0

if [ ! -d "$project" ]; then
  echo "error: $project not found; run xcodegen generate in ios/ first" >&2
  exit 1
fi

bundle_identifier() { # target configuration
  xcodebuild -project "$project" -target "$1" -configuration "$2" -showBuildSettings |
    awk -F ' = ' '$1 ~ /^ *PRODUCT_BUNDLE_IDENTIFIER$/ { print $2; exit }'
}

check() { # description expected actual
  if [ "$3" = "$2" ]; then
    echo "ok    $1: $3"
  else
    echo "FAIL  $1: expected $2, got ${3:-nothing}"
    failures=$((failures + 1))
  fi
}

check "Pedos (Release)" com.serp.pedos "$(bundle_identifier Pedos Release)"
check "Pedos (Debug)" com.serp.pedos.debug "$(bundle_identifier Pedos Debug)"
check "PedosTests" com.serp.pedos.tests "$(bundle_identifier PedosTests Debug)"
check "PedosUITests" com.serp.pedos.uitests "$(bundle_identifier PedosUITests Debug)"
check "Info.plist CFBundleIdentifier" '$(PRODUCT_BUNDLE_IDENTIFIER)' \
  "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' Pedos/Info.plist)"

# The Fixture Library never ships to regular users (AGENTS.md).
derived=$(mktemp -d "${TMPDIR:-/tmp}/pedos-release.XXXXXX")
trap 'rm -rf "$derived"' EXIT
echo "Building Release for the simulator to check its contents..."
xcodebuild build -project "$project" -scheme Pedos -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO -quiet
release_app="$derived/Build/Products/Release-iphonesimulator/Pedos.app"
check "Release app built" yes "$([ -x "$release_app/Pedos" ] && echo yes)"
check "Release app audio files" none "$(
  find "$release_app" -type f \( -iname '*.mp3' -o -iname '*.wav' -o -iname '*.m4a' \
    -o -iname '*.caf' -o -iname '*.aif' -o -iname '*.aiff' \) -exec basename {} \; |
    sort | tr '\n' ' ' | sed 's/ $//' | grep . || echo none
)"

if [ "$failures" -ne 0 ]; then
  echo "$failures build check(s) failed" >&2
  exit 1
fi
