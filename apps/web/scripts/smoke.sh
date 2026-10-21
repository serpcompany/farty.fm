#!/usr/bin/env bash
# Post-deploy smoke test: smoke.sh <base-url> <staging|production>
#
# <base-url> is the deploy's workers.dev host in CI, or a local preview. The checks send the smoke
# test's header, which keeps a workers.dev host from redirecting and passes the Staging gate
# without the password, keeping noindex.
#
# It checks that the pages and icons answer and the microphone is allowed for the site itself;
# that canonicals, robots.txt and the sitemaps name the environment's own host; and the Staging
# gate (worker.ts): a missing or wrong password is refused, except for robots.txt and the header,
# only the password drops noindex, and the Fixture Library, which only Staging carries, needs the
# password even with the header. Production has no gate, is indexable, allows crawling and carries
# no Fixture Library. On a workers.dev host, a request without the header gets a 308 to the
# environment's own host. Off localhost it checks that host too, and `www` for Production, unless
# Bot Fight Mode blocks this machine there.
#
# Sign-in (#152), off localhost: the dev mailbox (/dev/mail/) is never served, the session endpoint
# answers JSON, and a malformed sign-in gets a 400. Both need the environment's BETTER_AUTH_SECRET
# (.github/workflows/web-auth-secret.yml); without it they get a 503. A local preview's sign-in is
# the e2e journey's (e2e/sign-in.spec.ts).
set -euo pipefail

usage='usage: smoke.sh <base-url> <staging|production>'
base="${1:?$usage}"
env="${2:?$usage}"
base="${base%/}"
case "$env" in
  production) canonical=https://farty.fm ;;
  staging) canonical=https://staging.farty.fm ;;
  *)
    echo "$usage" >&2
    exit 2
    ;;
esac
failures=0
seen=''
tries=5

smoke=(-H 'x-pedos-smoke-test: 1')
# Staging's public password, a plain variable in wrangler.jsonc. The gate ignores the username.
password=(-u 'pedos:stagingpassword')
wrong_password=(-u 'pedos:wrong')
challenge='www-authenticate: Basic realm="farty staging", charset="UTF-8"'
# A file Workers serves from `assets` (public/), not through Next as /icon.png is.
static_file=/welcome-icon.png
# The Fixture Library's index (scripts/fixture-library.ts), in the Staging build only.
fixture_index=/fixtures/recordings/index.json

pass() { echo "ok   $1"; }
fail() {
  echo "FAIL $1${seen:+ (got: $seen)}"
  failures=$((failures + 1))
}

# eventually <message> <check> [args...]: retries a check $tries times, 3 s apart, since a deploy
# takes a few seconds to reach every location.
eventually() {
  local message="$1" try
  shift
  seen=''
  for ((try = 1; try <= tries; try++)); do
    if "$@"; then
      pass "$message"
      return
    fi
    if ((try < tries)); then sleep 3; fi
  done
  fail "$message"
}

# head_of <url> [curl options...]: the status line and headers, without carriage returns.
head_of() {
  local url="$1"
  shift
  curl -sS -o /dev/null -D - "$@" "$url" | tr -d '\r'
}

# body_of <url> [curl options...]: the body, without carriage returns.
body_of() {
  local url="$1"
  shift
  curl -sS "$@" "$url" | tr -d '\r'
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
  headers=$(head_of "$base/" "$@")
  seen=$(head -n 1 <<<"$headers")
  grep -qi '^permissions-policy: microphone=(self)' <<<"$headers"
}

# refuses <url> [curl options...]: 401, the Basic challenge, and no-store.
refuses() {
  local headers
  headers=$(head_of "$@")
  seen=$(head -n 1 <<<"$headers")
  [[ "$(status_in "$headers")" == 401 ]] &&
    grep -qixF "$challenge" <<<"$headers" &&
    grep -qix 'cache-control: no-store' <<<"$headers"
}

# serves <url> <noindex|indexable> [curl options...]: 200 with no challenge, and with or without
# X-Robots-Tag noindex.
serves() {
  local url="$1" indexing="$2" headers
  shift 2
  headers=$(head_of "$url" "$@")
  seen="$(head -n 1 <<<"$headers") $(grep -i '^x-robots-tag:' <<<"$headers" || true)"
  [[ "$(status_in "$headers")" == 200 ]] || return 1
  if grep -qi '^www-authenticate:' <<<"$headers"; then return 1; fi
  if grep -qi '^x-robots-tag:.*noindex' <<<"$headers"; then
    [[ "$indexing" == noindex ]]
  else
    [[ "$indexing" == indexable ]]
  fi
}

# never_serves <url> [curl options...]: anything but 200.
never_serves() {
  local headers
  headers=$(head_of "$@")
  seen=$(head -n 1 <<<"$headers")
  [[ "$(status_in "$headers")" != 200 ]]
}

# redirects <url> <location> [curl options...]: a 308 to <location>.
redirects() {
  local url="$1" want="$2" headers
  shift 2
  headers=$(head_of "$url" "$@")
  seen="$(head -n 1 <<<"$headers") $(grep -i '^location:' <<<"$headers" || true)"
  [[ "$(status_in "$headers")" == 308 ]] && grep -qixF "location: $want" <<<"$headers"
}

# names_canonical <path> <url> [curl options...]: the page has one canonical link, to <url>.
names_canonical() {
  local path="$1" want="$2" links
  shift 2
  links=$(body_of "$base$path" "$@" | grep -o '<link rel="canonical"[^>]*>' || true)
  seen=$(tr '\n' ' ' <<<"$links")
  [[ "$links" == "<link rel=\"canonical\" href=\"$want\"/>" ]]
}

# refuses_a_bad_sign_in: a sign-in with a malformed email, from the site's own origin, gets Better
# Auth's 400 as JSON, so the request reached Better Auth and was refused there.
refuses_a_bad_sign_in() {
  local result
  result=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "${smoke[@]}" \
    -H "origin: $canonical" -H 'content-type: application/json' \
    --data '{"email":"not-an-email","otp":"000000"}' "$base/api/auth/sign-in/email-otp")
  seen="$result"
  [[ "$result" == '400 application/json'* ]]
}

robots() { body_of "$base/robots.txt" "${smoke[@]}"; }

# robots.txt answers even with a wrong password, which the smoke test's header doesn't pass.
robots_needs_no_password() {
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' "${smoke[@]}" "${wrong_password[@]}" \
    "$base/robots.txt")
  seen="$status"
  [[ "$status" == 200 ]]
}

lists_the_sitemap_index() {
  local body
  body=$(robots)
  seen=$(grep -i '^sitemap:' <<<"$body" | tr '\n' ' ' || true)
  grep -qxF "Sitemap: $canonical/sitemap-index.xml" <<<"$body"
}

# robots_txt <allows|disallows>: the `User-Agent: *` group allows everything, or nothing.
robots_txt() {
  local body
  body=$(robots)
  seen=$(tr '\n' ' ' <<<"$body")
  if [[ "$1" == allows ]]; then
    [[ "$body" == *$'User-Agent: *\nAllow: /\n'* ]] && ! grep -qix 'disallow: /' <<<"$body"
  else
    [[ "$body" == *$'User-Agent: *\nDisallow: /\n'* ]]
  fi
}

gives_the_auditor_production_rules() {
  local body
  body=$(robots)
  seen=$(tr '\n' ' ' <<<"$body")
  [[ "$body" == *$'User-Agent: AhrefsSiteAudit\nAllow: /\n'* ]]
}

# sitemap_lists <path> <url...>: the sitemap is XML and lists exactly these URLs, in order.
sitemap_lists() {
  local path="$1" result locs
  shift
  result=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "${smoke[@]}" "$base$path")
  locs=$(body_of "$base$path" "${smoke[@]}" | grep -o '<loc>[^<]*</loc>' |
    sed -e 's|<loc>||' -e 's|</loc>||' | tr '\n' ' ' || true)
  seen="$result: $locs"
  [[ "$result" == '200 application/xml'* && "$locs" == "$* " ]]
}

# blocked <url>: Bot Fight Mode challenged this machine there, or Cloudflare refused it.
blocked() {
  local headers
  headers=$(head_of "$1" || true)
  grep -qi '^cf-mitigated: *challenge' <<<"$headers" || [[ "$(status_in "$headers")" == 403 ]]
}

# on_the_host <url> <message> <check> [args...]: runs a check on a branded host, or skips it with
# a warning when Bot Fight Mode blocks this machine there.
on_the_host() {
  local url="$1" message="$2"
  shift 2
  if blocked "$url"; then
    echo "skip $message: Bot Fight Mode blocked this machine"
    echo "::warning::Bot Fight Mode blocked this machine at $url, so the check that $message" \
      "didn't run. Run apps/web/scripts/smoke.sh from a machine it doesn't block to check it."
    return
  fi
  eventually "$message" "$@"
}

for page in / /recordings/; do
  eventually "$page answers with a page" answers "$page" 200 text/html "${smoke[@]}"
done
for icon in /icon.png /apple-icon.png "$static_file"; do
  eventually "$icon answers with a PNG" answers "$icon" 200 image/png "${smoke[@]}"
done
eventually 'Permissions-Policy allows the microphone for the site' \
  allows_the_microphone "${smoke[@]}"
eventually 'robots.txt answers without the password' robots_needs_no_password
eventually "robots.txt lists the sitemap index on $canonical" lists_the_sitemap_index
eventually "the sitemap index lists the pages sitemap on $canonical" \
  sitemap_lists /sitemap-index.xml "$canonical/sitemap-pages.xml"
eventually "the pages sitemap lists the public pages on $canonical" \
  sitemap_lists /sitemap-pages.xml "$canonical" "$canonical/privacy/" "$canonical/support/"

if [[ "$env" == production ]]; then
  eventually 'Production is indexable' serves "$base/" indexable "${smoke[@]}"
  for path in / "$static_file"; do
    eventually "Production asks for no password on $path, even given a wrong one" \
      serves "$base$path" indexable "${smoke[@]}" "${wrong_password[@]}"
  done
  eventually "the home page's canonical is $canonical" \
    names_canonical / "$canonical" "${smoke[@]}"
  eventually "the Privacy page's canonical is $canonical/privacy/" \
    names_canonical /privacy/ "$canonical/privacy/" "${smoke[@]}"
  eventually "Production's robots.txt allows crawling" robots_txt allows
  eventually 'Production carries no Fixture Library' \
    never_serves "$base$fixture_index" "${smoke[@]}"
else
  for path in / "$static_file"; do
    eventually "$path with a wrong password asks for the password, even with the header" \
      refuses "$base$path" "${smoke[@]}" "${wrong_password[@]}"
    eventually "$path with the password answers, with no noindex" \
      serves "$base$path" indexable "${smoke[@]}" "${password[@]}"
  done
  eventually "the smoke test's header passes without the password, with noindex" \
    serves "$base/" noindex "${smoke[@]}"
  eventually "the home page's canonical is $canonical" \
    names_canonical / "$canonical" "${smoke[@]}" "${password[@]}"
  eventually "the Privacy page's canonical is $canonical/privacy/" \
    names_canonical /privacy/ "$canonical/privacy/" "${smoke[@]}" "${password[@]}"
  eventually "the Fixture Library asks for the password, even with the smoke test's header" \
    refuses "$base$fixture_index" "${smoke[@]}"
  eventually "robots.txt disallows every crawler" robots_txt disallows
  eventually "robots.txt gives AhrefsSiteAudit Production's rules" \
    gives_the_auditor_production_rules
fi

local_base='^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$'
if [[ "$base" =~ $local_base && "$env" == staging ]]; then
  # A local preview has no workers.dev redirect, so a request with no password meets the gate.
  for path in / "$static_file"; do
    eventually "$path with no password asks for the password" refuses "$base$path"
  done
fi

if [[ "$base" =~ ^https://[^/]+\.workers\.dev$ ]]; then
  # A new deploy's hosts can take a little longer to answer.
  tries=10
  for path in /privacy/ /privacy; do
    eventually "$path on workers.dev, without the header, gets a 308 to $canonical/privacy/" \
      redirects "$base$path" "$canonical/privacy/"
  done
fi

if [[ ! "$base" =~ $local_base ]]; then
  tries=10
  eventually 'the dev mailbox is not served' answers /dev/mail/ 404 '' "${smoke[@]}"
  eventually 'the session endpoint answers JSON' \
    answers /api/auth/get-session 200 application/json "${smoke[@]}"
  eventually 'a malformed sign-in from the site gets a 400' refuses_a_bad_sign_in
  if [[ "$env" == production ]]; then
    on_the_host "$canonical/" "a request at $canonical/ gets 200 with no password and no noindex" \
      serves "$canonical/" indexable
    on_the_host https://www.farty.fm/privacy \
      "https://www.farty.fm/privacy gets a 308 to $canonical/privacy/" \
      redirects https://www.farty.fm/privacy "$canonical/privacy/"
  else
    on_the_host "$canonical/" "a request with no password at $canonical/ gets 401" \
      refuses "$canonical/"
  fi
fi

if ((failures > 0)); then
  echo "$failures check(s) failed on $base"
  if [[ "$env" == production ]]; then
    echo "If the sign-in checks got a 503, Production has no BETTER_AUTH_SECRET yet. Run, once:"
    echo "  gh workflow run web-auth-secret.yml --ref main -f environment=production"
    echo "then re-run this deploy's job."
  fi
  exit 1
fi
echo "All smoke checks passed on $base"
