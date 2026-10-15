#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo 'Run pnpm setup:local first.' >&2; exit 1; }
pnpm build:server
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
node --env-file-if-exists=.env dist/apps/api/src/main.js & pids+=("$!")
node --env-file-if-exists=.env dist/apps/job-worker/src/main.js & pids+=("$!")
node --env-file-if-exists=.env dist/apps/gateway-worker/src/main.js & pids+=("$!")
pnpm --dir apps/admin-web dev & pids+=("$!")
wait -n "${pids[@]}"
