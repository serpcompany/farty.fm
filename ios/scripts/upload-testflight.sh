#!/bin/sh
# Archives the Release app, signs it for App Store Connect and uploads it to TestFlight.
#
# The archive is built unsigned. Export signs it with cloud signing: Xcode creates the
# distribution certificate and profile through the App Store Connect API, so the runner
# needs no certificate files and the team needs no registered devices. That takes an API
# key with the Admin role.
#
# Environment:
#   BUILD_NUMBER   CFBundleVersion; must be higher than the last upload of this version
#   APPLE_TEAM_ID  the Apple Developer team that owns com.serp.pedos
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the AuthKey_<ASC_KEY_ID>.p8 file)
#   OUTPUT_DIR     optional; where the archive and the .ipa go
#
# CI runs it (.github/workflows/testflight.yml). Run after `xcodegen generate`:
#   ios/scripts/upload-testflight.sh                 archive, check, sign, check, upload
#   ios/scripts/upload-testflight.sh --archive-only  archive and check it; needs no key
set -eu

cd "$(dirname "$0")/.."
project=Pedos.xcodeproj
bundle_id=com.serp.pedos
archive_only=no
[ "${1:-}" = "--archive-only" ] && archive_only=yes

fail() {
  echo "error: $*" >&2
  exit 1
}

[ -d "$project" ] || fail "$project not found; run xcodegen generate in ios/ first"
: "${BUILD_NUMBER:?set BUILD_NUMBER}"
if [ "$archive_only" = no ]; then
  : "${APPLE_TEAM_ID:?set APPLE_TEAM_ID}"
  : "${ASC_KEY_ID:?set ASC_KEY_ID}"
  : "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
  : "${ASC_KEY_PATH:?set ASC_KEY_PATH}"
  [ -f "$ASC_KEY_PATH" ] || fail "no API key at $ASC_KEY_PATH"
  [ "$(basename "$ASC_KEY_PATH")" = "AuthKey_$ASC_KEY_ID.p8" ] ||
    fail "name the key file AuthKey_$ASC_KEY_ID.p8 (altool looks it up by that name)"
fi

out=${OUTPUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/pedos-testflight.XXXXXX")}
mkdir -p "$out"
archive="$out/Pedos.xcarchive"
echo "Output: $out"

echo "Archiving Release $BUILD_NUMBER (unsigned)..."
xcodebuild archive -project "$project" -scheme Pedos -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" CODE_SIGNING_ALLOWED=NO -quiet

app="$archive/Products/Applications/Pedos.app"
[ -x "$app/Pedos" ] || fail "the archive has no Pedos.app"
plist_value() { /usr/libexec/PlistBuddy -c "Print :$1" "$app/Info.plist" 2>/dev/null || true; }
[ "$(plist_value CFBundleIdentifier)" = "$bundle_id" ] ||
  fail "bundle identifier is $(plist_value CFBundleIdentifier), not $bundle_id"
[ "$(plist_value CFBundleVersion)" = "$BUILD_NUMBER" ] ||
  fail "build number is $(plist_value CFBundleVersion), not $BUILD_NUMBER"
[ "$(plist_value CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconName)" = AppIcon ] ||
  fail "the app has no icon"
# The Fixture Library never ships to regular users (AGENTS.md).
audio=$(find "$app" -type f \( -iname '*.mp3' -o -iname '*.wav' -o -iname '*.m4a' \
  -o -iname '*.caf' -o -iname '*.aif' -o -iname '*.aiff' \) -exec basename {} \;)
[ -z "$audio" ] || fail "the Release app contains audio: $audio"
echo "ok    archive: $bundle_id $(plist_value CFBundleShortVersionString) ($BUILD_NUMBER), icon, no audio"

[ "$archive_only" = yes ] && exit 0

echo "Signing for App Store Connect..."
cat >"$out/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
EOF
xcodebuild -exportArchive -archivePath "$archive" -exportPath "$out/export" \
  -exportOptionsPlist "$out/ExportOptions.plist" -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" -quiet

ipa="$out/export/Pedos.ipa"
[ -f "$ipa" ] || fail "export made no Pedos.ipa"
unzipped="$out/ipa"
rm -rf "$unzipped"
ditto -x -k "$ipa" "$unzipped"
signed_app="$unzipped/Payload/Pedos.app"
codesign --verify --strict "$signed_app" || fail "the signed app does not verify"
entitlements=$(codesign -d --entitlements - --xml "$signed_app" 2>/dev/null)
entitlement() { printf '%s' "$entitlements" | plutil -extract "$1" raw -o - - 2>/dev/null || true; }
[ "$(entitlement application-identifier)" = "$APPLE_TEAM_ID.$bundle_id" ] ||
  fail "application-identifier is '$(entitlement application-identifier)', not $APPLE_TEAM_ID.$bundle_id"
[ "$(entitlement get-task-allow)" != true ] || fail "the app is signed for development"
echo "ok    signed: $(codesign -dvv "$signed_app" 2>&1 | sed -n 's/^Authority=\(Apple Distribution.*\)/\1/p' | head -n 1)"

echo "Uploading to App Store Connect..."
API_PRIVATE_KEYS_DIR=$(dirname "$ASC_KEY_PATH") xcrun altool --upload-app -f "$ipa" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
echo "Uploaded $bundle_id ($BUILD_NUMBER). It shows in TestFlight once App Store Connect processes it."
