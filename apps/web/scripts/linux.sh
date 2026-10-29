#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: scripts/linux.sh <command> [args...]" >&2
  exit 2
fi

app=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$app/../.." && pwd)
host_root=$root
host_npmrc=$HOME/.npmrc
if command -v cygpath >/dev/null 2>&1; then
  host_root=$(cygpath -m "$root")
  host_npmrc=$(cygpath -m "$host_npmrc")
fi

node_version=$(tr -d '[:space:]' <"$root/.node-version")
playwright_version=$(grep -m 1 -oE "'@playwright/test@[0-9]+\.[0-9]+\.[0-9]+'" "$root/pnpm-lock.yaml" |
  grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
image="farty-linux:node-$node_version-playwright-$playwright_version"

docker build --quiet --tag "$image" \
  --build-arg "NODE_VERSION=$node_version" \
  --build-arg "PLAYWRIGHT_VERSION=$playwright_version" \
  --file "$app/scripts/linux.Dockerfile" "$app/scripts" >/dev/null

published_port=()
if [[ -n "${LINUX_PORT:-}" ]]; then
  published_port=(--publish "$LINUX_PORT:$LINUX_PORT")
fi

checkout_volumes="farty-linux-$(printf '%s' "$host_root" | cksum | cut -d ' ' -f 1)"

MSYS_NO_PATHCONV=1 docker run --rm "${published_port[@]}" \
  --volume "$host_root:/work" \
  --volume "$checkout_volumes-root-modules:/work/node_modules" \
  --volume "$checkout_volumes-web-modules:/work/apps/web/node_modules" \
  --volume "$checkout_volumes-wrangler:/work/apps/web/.wrangler" \
  --volume farty-linux-pnpm-store:/pnpm-store \
  --volume "$host_npmrc:/root/.npmrc:ro" \
  --env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  --env CI \
  "$image" bash -c \
  'pnpm config set store-dir /pnpm-store >/dev/null && pnpm install --frozen-lockfile --ignore-scripts --reporter=silent && "$@"' \
  linux "$@"
