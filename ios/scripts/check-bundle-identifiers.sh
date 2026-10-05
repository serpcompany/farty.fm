#!/bin/sh
# Checks the SERP Apple app build identity for Pedos: only Release and QA carry the
# product identifier, Debug and the test bundles have their own, and Info.plist
# takes the identifier from the build setting.
#
# It also checks which bundled audio each build excludes: Release excludes all of
# it (the Fixture Library, the prototype's sample takes and its Song renders), and
# QA excludes the sample takes. scripts/check-release-build.sh checks the built
# Release app, and scripts/upload-testflight.sh checks every archive.
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
qa_settings=$(xcodebuild -project "$project" -alltargets -configuration QA -showBuildSettings)
release_settings=$(xcodebuild -project "$project" -alltargets -configuration Release -showBuildSettings)

setting() { # settings target name
  printf '%s\n' "$1" | awk -v target="$2" -v name="$3" '
    /^Build settings for action build and target / { current = $NF; sub(/:$/, "", current) }
    current == target && $1 == name && $2 == "=" { sub(/^[^=]*= /, ""); print; exit }'
}

bundle_identifier() { # target configuration
  case "$2" in
    Release) settings=$release_settings ;;
    QA) settings=$qa_settings ;;
    *) settings=$debug_settings ;;
  esac
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
check "Pedos (QA)" com.serp.pedos "$(bundle_identifier Pedos QA)"
check "Pedos (Debug)" com.serp.pedos.debug "$(bundle_identifier Pedos Debug)"
check "PedosTests" com.serp.pedos.tests "$(bundle_identifier PedosTests Debug)"
check "PedosUITests" com.serp.pedos.uitests "$(bundle_identifier PedosUITests Debug)"
check "Info.plist CFBundleIdentifier" '$(PRODUCT_BUNDLE_IDENTIFIER)' \
  "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' Pedos/Info.plist)"

# The Fixture Library never ships to regular users (AGENTS.md).
check "Release excludes the Fixture Library" "[0-9][0-9][0-9]__*" \
  "$(setting "$release_settings" Pedos EXCLUDED_SOURCE_FILE_NAMES)"
check "QA keeps the Fixture Library" "" "$(setting "$qa_settings" Pedos EXCLUDED_SOURCE_FILE_NAMES)"
check "Debug keeps the Fixture Library" "" "$(setting "$debug_settings" Pedos EXCLUDED_SOURCE_FILE_NAMES)"

if [ "$failures" -ne 0 ]; then
  echo "$failures build check(s) failed" >&2
  exit 1
fi
