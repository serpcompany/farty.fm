#!/usr/bin/env bash
# Post-deploy smoke test: smoke.sh <base-url> <staging|production>
# Checks the pages and icons answer, the microphone is allowed for the site itself, and the
# Staging gate (worker.ts): outside Production every request needs the password, static files
# included, except robots.txt and the smoke test's header, and only a request with the password
# drops noindex. The Fixture Library, which only Staging carries, needs the password even with the
# smoke test's header. Production has no gate, is indexable and carries no Fixture Library.
set -euo pipefail

base="${1:?usage: smoke.sh <base-url> <staging|production>}"
env="${2:?usage: smoke.sh <base-url> <staging|production>}"
base="${base%/}"
failures=0
seen=''

# The smoke test's header passes the Staging gate without the password, keeping noindex.
smoke=(-H 'x-pedos-smoke-test: 1')
# Staging's public password, a plain variable in wrangler.jsonc. The gate ignores the username.
password=(-u 'pedos:stagingpassword')
wrong_password=(-u 'pedos:wrong')
challenge='www-authenticate: Basic realm="pedos staging", charset="UTF-8"'
# A file Workers serves from `assets` (public/), not through Next as /icon.png is.
static_file=/welcome-icon.png
# The Fixture Library's index (scripts/fixture-library.ts), in the Staging build only.
fixture_index=/fixtures/recordings/index.json

pass() { echo "ok   $1"; }
fail() {
  echo "FAIL $1${seen:+ (got: $seen)}"
  failures=$((failures + 1))
}

# Retries a check, since a deploy takes a few seconds to reach every location.
eventually() {
  local message="$1"
  shift
  for _ in 1 2 3 4 5; do
    if "$@"; then
      pass "$message"
      return
    fi
    sleep 3
  done
  fail "$message"
}

# headers_of <path> [curl options...]: the status line and headers, without carriage returns.
headers_of() {
  local path="$1"
  shift
  curl -sS -o /dev/null -D - "$@" "$base$path" | tr -d '\r'
}

status_in() { head -n 1 <<<"$1" | cut -d ' ' -f 2; }

# answers <path> <status> <content type> [curl options...]
answers() {
  local path="$1" want_status="$2" want_type="$3" result
  shift 3
  result=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$@" "$base$path")
  seen="$result"
  [[ "${result%% *}" == "$want_status" && "${result#* }" == "$want_type"* ]]
}

# allows_the_microphone [curl options...]
allows_the_microphone() {
  local headers
  headers=$(headers_of / "$@")
  seen=$(head -n 1 <<<"$headers")
  grep -qi '^permissions-policy: microphone=(self)' <<<"$headers"
}

# asks_for_the_password <path> [curl options...]: 401, the Basic challenge, and no-store.
asks_for_the_password() {
  local path="$1" headers
  shift
  headers=$(headers_of "$path" "$@")
  seen=$(head -n 1 <<<"$headers")
  [[ "$(status_in "$headers")" == 401 ]] &&
    grep -qixF "$challenge" <<<"$headers" &&
    grep -qix 'cache-control: no-store' <<<"$headers"
}

# serves <path> <noindex|indexable> [curl options...]: 200, with or without X-Robots-Tag noindex.
serves() {
  local path="$1" indexing="$2" headers
  shift 2
  headers=$(headers_of "$path" "$@")
  seen="$(head -n 1 <<<"$headers") $(grep -i '^x-robots-tag:' <<<"$headers" || true)"
  [[ "$(status_in "$headers")" == 200 ]] || return 1
  if [[ "$indexing" == noindex ]]; then
    grep -qi '^x-robots-tag:.*noindex' <<<"$headers"
  else
    ! grep -qi '^x-robots-tag:.*noindex' <<<"$headers"
  fi
}

# never_serves <path> [curl options...]: anything but 200.
never_serves() {
  local path="$1" headers
  shift
  headers=$(headers_of "$path" "$@")
  seen=$(head -n 1 <<<"$headers")
  [[ "$(status_in "$headers")" != 200 ]]
}

# never_challenges <path> [curl options...]: 200 and no WWW-Authenticate.
never_challenges() {
  local path="$1" headers
  shift
  headers=$(headers_of "$path" "$@")
  seen=$(head -n 1 <<<"$headers")
  [[ "$(status_in "$headers")" == 200 ]] && ! grep -qi '^www-authenticate:' <<<"$headers"
}

# robots_txt <disallows|allows>: robots.txt answers 200 without the password, and its
# `User-agent: *` group disallows everything, or doesn't.
robots_txt() {
  local want="$1" body
  body=$(curl -sS -f "$base/robots.txt" | tr -d '\r' | tr '[:upper:]' '[:lower:]') || return 1
  seen=$(tr '\n' ' ' <<<"$body")
  if [[ "$want" == disallows ]]; then
    # `disallow: /` on a line of its own, not a path such as `/api/`.
    [[ "$body" == *$'user-agent: *\ndisallow: /\n'* || "$body" == *$'user-agent: *\ndisallow: /' ]]
  else
    [[ "$body" != *$'disallow: /\n'* && "$body" != *'disallow: /' ]]
  fi
}

for page in / /recordings/; do
  eventually "$page answers with a page" answers "$page" 200 text/html "${smoke[@]}"
done
for icon in /icon.png /apple-icon.png "$static_file"; do
  eventually "$icon answers with a PNG" answers "$icon" 200 image/png "${smoke[@]}"
done
eventually 'Permissions-Policy allows the microphone for the site' \
  allows_the_microphone "${smoke[@]}"

if [[ "$env" == production ]]; then
  eventually 'Production is indexable' serves / indexable
  for path in / "$static_file"; do
    eventually "Production asks for no password on $path" never_challenges "$path"
    eventually "Production asks for no password on $path, even given a wrong one" \
      never_challenges "$path" "${wrong_password[@]}"
  done
  eventually "Production's robots.txt allows crawling" robots_txt allows
  eventually 'Production carries no Fixture Library' never_serves "$fixture_index"
else
  for path in / "$static_file"; do
    eventually "$path asks for the password" asks_for_the_password "$path"
    eventually "$path with the password answers, with no noindex" \
      serves "$path" indexable "${password[@]}"
  done
  eventually "the smoke test's header passes without the password, with noindex" \
    serves / noindex "${smoke[@]}"
  eventually "the smoke test's header with a wrong password asks for the password" \
    asks_for_the_password / "${smoke[@]}" "${wrong_password[@]}"
  eventually "the Fixture Library asks for the password, even with the smoke test's header" \
    asks_for_the_password "$fixture_index" "${smoke[@]}"
  eventually 'a wrong password asks for the password' \
    asks_for_the_password / "${wrong_password[@]}"
  eventually 'robots.txt answers without the password, disallowing every crawler' \
    robots_txt disallows
fi

if ((failures > 0)); then
  echo "$failures check(s) failed on $base"
  exit 1
fi
echo "All smoke checks passed on $base"
