#!/bin/sh
# Checks the SERP native app build identity for Pedos: only Release carries the
# product identifier, Debug and the test bundles have their own, and Info.plist
# takes the identifier from the build setting.
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

if [ "$failures" -ne 0 ]; then
  echo "$failures bundle identifier check(s) failed" >&2
  exit 1
fi
