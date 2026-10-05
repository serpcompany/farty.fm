#!/bin/sh
# Checks the SERP native app build identity for Pedos: only Release carries the
# product identifier, Debug and the test bundles have their own, and Info.plist
# takes the identifier from the build setting.
#
# It also checks that Release excludes the design prototype's audio (the Fixture
# Library's Recordings and its renders of each Song), which is for Debug builds
# only. The built app is checked too, before every TestFlight upload:
# scripts/upload-testflight.sh fails if the archive contains any audio.
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

# Every target's build settings, read once per configuration: each xcodebuild call takes most
# of a minute on CI.
debug_settings=$(xcodebuild -project "$project" -alltargets -configuration Debug -showBuildSettings)
release_settings=$(xcodebuild -project "$project" -alltargets -configuration Release -showBuildSettings)

setting() { # settings target name
  printf '%s\n' "$1" | awk -v target="$2" -v name="$3" '
    /^Build settings for action build and target / { current = $NF; sub(/:$/, "", current) }
    current == target && $1 == name && $2 == "=" { sub(/^[^=]*= /, ""); print; exit }'
}

bundle_identifier() { # target configuration
  if [ "$2" = Release ]; then settings=$release_settings; else settings=$debug_settings; fi
  setting "$settings" "$1" PRODUCT_BUNDLE_IDENTIFIER
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

# The Fixture Library never ships to regular users (AGENTS.md), and neither do
# the prototype's Song renders, which are made from it.
check "Release excludes the prototype audio" "rec-*.mp3 song-*.mp3" \
  "$(setting "$release_settings" Pedos EXCLUDED_SOURCE_FILE_NAMES)"
check "Debug keeps the prototype audio" "" "$(setting "$debug_settings" Pedos EXCLUDED_SOURCE_FILE_NAMES)"

if [ "$failures" -ne 0 ]; then
  echo "$failures build check(s) failed" >&2
  exit 1
fi
