#!/usr/bin/env bash
# Post-deploy smoke test: smoke.sh <base-url> <staging|production>
# Checks the pages and icons answer, the microphone is allowed for the site itself, and only
# Production may be indexed.
set -euo pipefail

base="${1:?usage: smoke.sh <base-url> <staging|production>}"
env="${2:?usage: smoke.sh <base-url> <staging|production>}"
base="${base%/}"
failures=0

check() {
  local path="$1" want_status="$2" want_type="$3"
  local result status type
  result=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$base$path")
  status="${result%% *}"
  type="${result#* }"
  if [[ "$status" == "$want_status" && "$type" == "$want_type"* ]]; then
    echo "ok   $path $status $type"
  else
    echo "FAIL $path: got $status $type, want $want_status $want_type"
    failures=$((failures + 1))
  fi
}

check / 200 text/html
check /recordings/ 200 text/html
check /icon.png 200 image/png
check /apple-icon.png 200 image/png
check /welcome-icon.png 200 image/png

headers=$(curl -sS -D - -o /dev/null "$base/")
if grep -qi '^permissions-policy: microphone=(self)' <<<"$headers"; then
  echo "ok   Permissions-Policy allows the microphone for the site"
else
  echo "FAIL Permissions-Policy: microphone=(self) missing"
  failures=$((failures + 1))
fi

noindex=$(grep -ci '^x-robots-tag: noindex' <<<"$headers" || true)
if [[ "$env" == production && "$noindex" != 0 ]]; then
  echo "FAIL Production must be indexable, but sends X-Robots-Tag: noindex"
  failures=$((failures + 1))
elif [[ "$env" != production && "$noindex" == 0 ]]; then
  echo "FAIL $env must send X-Robots-Tag: noindex"
  failures=$((failures + 1))
else
  echo "ok   X-Robots-Tag right for $env"
fi

if ((failures > 0)); then
  echo "$failures check(s) failed on $base"
  exit 1
fi
echo "All smoke checks passed on $base"
